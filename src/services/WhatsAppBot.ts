import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import path from 'path';
import WhatsAppConnection from '../models/WhatsAppConnection';

class WhatsAppBot extends EventEmitter {
  private sock: any;
  private connectionReady: boolean = false;
  private authPath: string;

  constructor(authPath: string) {
    super();
    this.authPath = authPath;
  }

  async initialize() {
    const authFolder = path.join(process.cwd(), 'auth', this.authPath);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    
    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
    this.sock.ev.on('messages.upsert', this.handleMessage.bind(this));
  }

  private async handleConnectionUpdate(update: any) {
    const { connection, lastDisconnect } = update;

    // Update connection status in database
    await WhatsAppConnection.findOneAndUpdate(
      { authPath: this.authPath },
      { 
        status: connection === 'open' ? 'connected' : 'disconnected',
        lastConnection: connection === 'open' ? new Date() : undefined
      }
    );

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        await this.initialize();
      }
    } else if (connection === 'open') {
      this.connectionReady = true;
      this.emit('ready');
    }
  }

  private async handleMessage({ messages }: any) {
    if (!this.connectionReady) return;

    for (const message of messages) {
      if (message.key.fromMe) continue;
      
      const chatId = message.key.remoteJid;
      const messageText = message.message?.conversation || 
                         message.message?.extendedTextMessage?.text || '';

      this.emit('message', {
        chatId,
        messageText,
        message
      });
    }
  }

  async sendMessage(to: string, text: string) {
    if (!this.connectionReady) throw new Error('WhatsApp connection not ready');
    return await this.sock.sendMessage(to, { text });
  }

  async requestPairingCode(phoneNumber: string) {
    if (!this.sock.authState.creds.registered) {
      const code = await this.sock.requestPairingCode(phoneNumber);
      return code;
    }
    return null;
  }

  getConnectionStatus() {
    return {
      ready: this.connectionReady,
      authPath: this.authPath
    };
  }
}

export default WhatsAppBot;
