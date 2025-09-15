const { 
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs').promises;
const QRCode = require('qrcode');
const conversation = require('./conversation');
const logCollector = require('../utils/logCollector');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.messageHandlers = new Set();
    this.qrCodeListeners = new Set();
    this.statusListeners = new Set();
    this.sessionDir = process.env.WA_SESSION_DIR || './wa-sessions';
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT_ATTEMPTS = Number(process.env.MAX_RECONNECT_ATTEMPTS) || 5;
    this.qr = null;
    this.connectionStatus = 'disconnected';

    // bind instance methods
    this.init = this.init.bind(this);
    this.handleConnectionUpdate = this.handleConnectionUpdate.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.logout = this.logout.bind(this);
    this.onMessage = this.onMessage.bind(this);
    this.onQRCode = this.onQRCode.bind(this);
    this.onStatusUpdate = this.onStatusUpdate.bind(this);
    this.getConnectionStatus = this.getConnectionStatus.bind(this);
    this.getCurrentQR = this.getCurrentQR.bind(this);
  }

  async init() {
    try {
      logger.info('Initializing WhatsApp bot...');
      await fs.mkdir(this.sessionDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      const signalStore = makeCacheableSignalKeyStore(state.keys, logger);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60_000,
        qrTimeout: 60_000,
        syncFullHistory: true,
        keys: signalStore,
      });

      this.sock.ev.on('connection.update', this.handleConnectionUpdate);
      this.sock.ev.on('messages.upsert', this.handleMessage);
      this.sock.ev.on('creds.update', saveCreds);

      logger.info('WhatsApp socket created');
      logCollector.add('WhatsApp socket created');

      // Greeting and menu flows are handled by the conversation state machine
      // Do NOT register an additional onMessage greeting here to avoid duplicate replies

      return true;
    } catch (err) {
      logger.error('Failed to initialize WhatsApp bot:', err);
      await fs.rm(this.sessionDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update || {};

    if (qr) {
      try {
        this.qr = await QRCode.toDataURL(qr);
        this.qrCodeListeners.forEach((l) => { try { l(this.qr); } catch (e) { logger.error('qr listener error', e); } });
        logCollector.add('QR generated');
      } catch (e) { logger.error('Failed to generate QR code:', e); }
    }

    if (connection) {
      this.connectionStatus = connection;
      this.statusListeners.forEach((l) => { try { l({ status: connection, attempts: this.reconnectAttempts }); } catch (e) { logger.error('status listener error', e); } });
      logCollector.add('Connection update: ' + connection);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      this.isConnected = false;
      if (!shouldReconnect) { await this.logout(); return; }
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        logger.info(`Reconnecting attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);
        await new Promise((r) => setTimeout(r, Number(process.env.RECONNECT_INTERVAL) || 5000));
        try { await this.init(); } catch (e) { logger.error('reconnect failed', e); }
      } else { logger.warn('Max reconnect attempts reached'); }
    } else if (connection === 'open') {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.qr = null;
      logger.info('WhatsApp connection opened');
    }
  }

  async handleMessage(upsert) {
    try {
      const { messages, type } = upsert || {};
      if (type !== 'notify' || !Array.isArray(messages)) return;
      for (const message of messages) {
        if (message.key?.fromMe) continue;
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const from = message.key.remoteJid;

        try {
          // Hand off to conversation state machine
          const result = await conversation.handleIncoming(from.replace('@s.whatsapp.net',''), text);
          if (result && result.reply) {
            await this.sendMessage(from, result.reply);
            logCollector.add('Replied to ' + from + ' with conversation reply');
          }

          // If session contains a placed order, attempt to create the remote order
          try {
            const mongoose = require('mongoose');
            // attempt to load session to check for order
            const Session = require('../models/session');
            const Order = require('../models/order');
            const sid = from.replace('@s.whatsapp.net','');
            const sdoc = await Session.findOne({ sessionId: sid }).lean().catch(()=>null);
            if (sdoc && sdoc.data && sdoc.data.order) {
              const sessionOrder = sdoc.data.order;
              const localOrderId = sessionOrder.id || sessionOrder.orderId || sessionOrder;
              if (localOrderId) {
                // load persistent order
                const oDoc = await Order.findOne({ orderId: localOrderId }).lean().catch(()=>null);
                // Only submit to provider if payment webhook has marked order ready_for_submit
                if (oDoc && oDoc.ready_for_submit && !oDoc.processing && !oDoc.remoteOrderId) {
                  // mark processing in DB/session to avoid duplicates
                  await Order.updateOne({ orderId: localOrderId }, { $set: { processing: true } }).catch(()=>{});
                  await Session.updateOne({ sessionId: sid }, { $set: { 'data.order.processing': true } }).catch(()=>{});

                  // build create payload from order record
                  const serviceId = oDoc.serviceId || oDoc.service || (oDoc.service && (oDoc.service.id || oDoc.service.serviceId)) || (oDoc.serviceId && String(oDoc.serviceId));
                  const link = oDoc.target || oDoc.link || '';
                  const quantity = oDoc.quantity || oDoc.qty || 1;
                  const buyer_phone = oDoc.paymentPhone || (oDoc.phone || '');

                  const createResp = await require('../services/smmguo').createOrder({ service: serviceId, link, quantity, buyer_phone });

                  // update persistent Order with provider response and status
                  try {
                    const newStatus = (createResp && (createResp.result || createResp.status || (createResp.error ? 'FAILED' : 'SUBMITTED'))) || 'SUBMITTED';
                    await Order.updateOne({ orderId: localOrderId }, { $set: { providerResponse: createResp, status: newStatus, processing: false, remoteOrderId: createResp && (createResp.order || createResp.id || createResp.reference || createResp.transid) || null } }).catch(()=>{});
                    await Session.updateOne({ sessionId: sid }, { $set: { 'data.order.remote': createResp, 'data.order.status': newStatus, 'data.order.processing': false } }).catch(()=>{});

                    if (createResp && createResp.error) {
                      // provider reported error, notify user and mark failed
                      await this.sendMessage(from, `Order submission failed: ${createResp.error}. Please contact admin.`);
                      logCollector.add('Provider error on order ' + localOrderId + ': ' + createResp.error);
                    } else {
                      // success-ish response
                      const remoteId = createResp && (createResp.order || createResp.id || createResp.reference || createResp.transid) || null;
                      const amount = oDoc.amount_due_tzs || oDoc.amount || 0;
                      await this.sendMessage(from, `Your order has been submitted to provider. Remote id: ${remoteId || 'n/a'}. Amount due: ${amount} TZS. We will notify you when fulfillment updates.`);
                      logCollector.add('Order submitted to provider: ' + localOrderId + ' -> ' + (remoteId || JSON.stringify(createResp)));
                    }
                  } catch (e) {
                    logCollector.add('Failed to save provider response for order ' + localOrderId + ': ' + (e && e.message));
                  }
                }
              }
            }
          } catch (e) {
            logger.error('order submission error', e);
            logCollector.add('order submission error: ' + e.message);
          }

        } catch (e) {
          logger.error('conversation handler error', e);
          logCollector.add('conversation handler error: ' + e.message);
        }

        for (const handler of this.messageHandlers) {
          try { await handler({ from: message.key.remoteJid, text, message, timestamp: message.messageTimestamp }); } catch (e) { logger.error('message handler error', e); }
        }
      }
    } catch (e) { logger.error('handleMessage error', e); }
  }

  async sendMessage(to, content) {
    if (!this.isConnected || !this.sock) throw new Error('WhatsApp bot is not connected');
    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    return this.sock.sendMessage(jid, { text: content });
  }

  async logout() {
    try {
      if (this.sock) { try { await this.sock.logout(); } catch (e) { logger.error('logout error', e); } this.sock.ev.removeAllListeners?.(); this.sock = null; }
      await fs.rm(this.sessionDir, { recursive: true, force: true }).catch(() => {});
      this.isConnected = false; this.qr = null; this.connectionStatus = 'disconnected';
    } catch (e) { logger.error('logout failed', e); throw e; }
  }

  onMessage(handler) { this.messageHandlers.add(handler); return () => this.messageHandlers.delete(handler); }
  onQRCode(listener) { this.qrCodeListeners.add(listener); if (this.qr) listener(this.qr); return () => this.qrCodeListeners.delete(listener); }
  onStatusUpdate(listener) { this.statusListeners.add(listener); listener({ status: this.connectionStatus, attempts: this.reconnectAttempts, isConnected: this.isConnected }); return () => this.statusListeners.delete(listener); }
  getConnectionStatus() { return { isConnected: this.isConnected, status: this.connectionStatus, reconnectAttempts: this.reconnectAttempts, hasQR: !!this.qr }; }
  getCurrentQR() { return this.qr; }
}

module.exports = new WhatsAppBot();