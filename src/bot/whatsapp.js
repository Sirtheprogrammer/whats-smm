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
        // syncFullHistory can cause Baileys to run init queries that sometimes fail with 'bad-request'
        // make it configurable via env; default to false to avoid init errors in unstable envs
        syncFullHistory: process.env.SYNC_FULL_HISTORY === 'true' ? true : false,
        keys: signalStore,
      });

      this.sock.ev.on('connection.update', this.handleConnectionUpdate);
      // wrap event listeners to prevent uncaught exceptions bubbling from baileys internals
      try {
        this.sock.ev.on('messages.upsert', this.handleMessage);
      } catch (e) {
        logger.error('failed to attach messages.upsert listener', e && e.message);
      }
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
        // detect interactive list/button replies and normalize to a text token
        let text = '';
        try {
          const listReply = message.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
          const btnReply = message.message?.buttonsResponseMessage?.selectedButtonId;
          if (listReply) {
            text = listReply;
          } else if (btnReply) {
            text = btnReply;
          } else {
            text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
          }
        } catch (e) {
          text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        }
        const from = message.key.remoteJid;

        // TEST COMMANDS: allow quick testing of buttons/lists/templates
        try {
          const cmd = (text || '').toString().trim();
          if (cmd === '!buttons') {
            const buttons = [
              { buttonId: 'btn_1', buttonText: { displayText: 'Option 1' }, type: 1 },
              { buttonId: 'btn_2', buttonText: { displayText: 'Option 2' }, type: 1 },
              { buttonId: 'btn_3', buttonText: { displayText: 'Option 3' }, type: 1 }
            ];
            await this.sendButtons(from, { text: 'Choose one:', footer: 'Bot Footer', buttons });
            continue;
          }
          if (cmd === '!list') {
            const sections = [
              {
                title: 'Section A',
                rows: [
                  { title: 'Row 1', rowId: 'row_1', description: 'First row' },
                  { title: 'Row 2', rowId: 'row_2', description: 'Second row' }
                ]
              }
            ];
            await this.sendList(from, { title: 'List title', text: 'Pick from the list', buttonText: 'Open list', footer: 'Footer', sections });
            continue;
          }
          if (cmd === '!template') {
            const templateButtons = [
              { index: 1, urlButton: { displayText: 'Open site', url: 'https://example.com' } },
              { index: 2, callButton: { displayText: 'Call', phoneNumber: '+123456789' } },
              { index: 3, quickReplyButton: { displayText: 'Quick reply', id: 'quick_1' } }
            ];
            await this.sendTemplate(from, { text: 'Template example', footer: 'Footer here', templateButtons });
            continue;
          }
        } catch (e) {
          logger.error('test command handler error', e && e.message);
        }

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

  // send a WhatsApp interactive list message
  async sendList(to, { title, text, buttonText, footer, sections }) {
    if (!this.sock) {
      // try to initialize socket if not present
      try { await this.init(); } catch (e) { /* ignore init errors here */ }
    }
    if (!this.isConnected || !this.sock) throw new Error('WhatsApp bot is not connected');
    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    const msg1 = { title: title || '', text: text || '', buttonText: buttonText || 'Select', footer: footer || '', sections: sections || [] };
    try {
      console.log('[whatsapp.sendList] sending payload (direct):', JSON.stringify(msg1));
      const r1 = await this.sock.sendMessage(jid, msg1);
      console.log('[whatsapp.sendList] sendMessage direct response:', JSON.stringify(r1, null, 2));
      return r1;
    } catch (e1) {
      console.warn('[whatsapp.sendList] direct payload failed:', e1 && (e1.message || e1));
      // try alternative payload shape
      const listMsg = { listMessage: { title: title || '', description: text || '', buttonText: buttonText || 'Select', footerText: footer || '', sections: sections || [] } };
      try {
        console.log('[whatsapp.sendList] sending payload (listMessage):', JSON.stringify(listMsg));
        const r2 = await this.sock.sendMessage(jid, listMsg);
        console.log('[whatsapp.sendList] sendMessage listMessage response:', JSON.stringify(r2, null, 2));
        return r2;
      } catch (e2) {
        logger.error('sendList failed with both payload formats', e1 && (e1.message||e1), e2 && (e2.message||e2));
        console.warn('[whatsapp.sendList] listMessage failed:', e2 && (e2.message || e2));

        // FALLBACK: send a plain numbered text listing so the user can still choose
        try {
          let plain = '';
          if (title) plain += `*${title}*\n`;
          if (text) plain += `${text}\n\n`;
          let counter = 1;
          if (Array.isArray(sections)) {
            for (const section of sections) {
              if (section.title) {
                plain += `_${section.title}_\n`;
              }
              if (Array.isArray(section.rows)) {
                for (const row of section.rows) {
                  // include rowId so user or bot can reference it; keep it readable
                  const safeRowId = row.rowId || row.id || '';
                  plain += `${counter}. ${row.title || safeRowId}`;
                  if (safeRowId) plain += `\n   id: ${safeRowId}`;
                  plain += '\n';
                  counter++;
                }
                plain += '\n';
              }
            }
          }
          plain += '\nReply with the number or the id shown above.';
          console.log('[whatsapp.sendList] sending fallback plain text menu');
          const r3 = await this.sock.sendMessage(jid, { text: plain });
          console.log('[whatsapp.sendList] fallback text response:', JSON.stringify(r3, null, 2));
          return r3;
        } catch (e3) {
          logger.error('sendList fallback text also failed', e3 && (e3.message || e3));
          return false;
        }
      }
    }
  }

  // send quick-reply buttons
  async sendButtons(to, { text, footer, buttons, headerType }) {
    if (!this.sock) {
      try { await this.init(); } catch (e) { /* ignore init errors */ }
    }
    if (!this.isConnected || !this.sock) throw new Error('WhatsApp bot is not connected');
    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    const payload = { text: text || '', footer: footer || '', buttons: buttons || [], headerType: headerType || 1 };
    try {
      console.log('[whatsapp.sendButtons] sending buttons payload:', JSON.stringify(payload));
      const r = await this.sock.sendMessage(jid, payload);
      console.log('[whatsapp.sendButtons] response:', JSON.stringify(r, null, 2));
      return r;
    } catch (err) {
      logger.error('sendButtons failed', err && (err.message || err));
      return false;
    }
  }

  // send template buttons (CTA / url / call / quick reply) using baileys templateButtons shape
  async sendTemplate(to, { text, footer, templateButtons }) {
    if (!this.sock) {
      try { await this.init(); } catch (e) { /* ignore init errors */ }
    }
    if (!this.isConnected || !this.sock) throw new Error('WhatsApp bot is not connected');
    const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    const payload = { text: text || '', footer: footer || '', templateButtons: templateButtons || [] };
    try {
      console.log('[whatsapp.sendTemplate] sending template payload:', JSON.stringify(payload));
      const r = await this.sock.sendMessage(jid, payload);
      console.log('[whatsapp.sendTemplate] response:', JSON.stringify(r, null, 2));
      return r;
    } catch (err) {
      logger.error('sendTemplate failed', err && (err.message || err));
      return false;
    }
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