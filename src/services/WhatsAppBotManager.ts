import { EventEmitter } from 'events';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { IBotInstance } from '../models/BotInstance';
import BotInstance from '../models/BotInstance';

interface WhatsAppBot {
  sock: any;
  status: 'active' | 'inactive' | 'connecting';
}

export class WhatsAppBotManager extends EventEmitter {
  private bots: Map<string, WhatsAppBot>;

  constructor() {
    super();
    this.bots = new Map();
  }

  async initializeBot(botInstance: IBotInstance): Promise<string | null> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(botInstance.authPath);
      
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
      });

      sock.ev.on('creds.update', saveCreds);
      
      sock.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(botInstance._id.toString(), update);
      });

      this.bots.set(botInstance._id.toString(), sock);

      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(botInstance.phoneNumber);
        return code;
      }

      return null;
    } catch (error) {
      console.error(`Failed to initialize bot ${botInstance._id}:`, error);
      throw error;
    }
  }

  private async handleConnectionUpdate(botId: string, update: any) {
    const { connection, lastDisconnect } = update;
    const bot = await BotInstance.findById(botId);

    if (!bot) return;

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      
      bot.status = shouldReconnect ? 'connecting' : 'inactive';
      await bot.save();

      if (shouldReconnect) {
        await this.initializeBot(bot);
      }
    } else if (connection === 'open') {
      bot.status = 'active';
      await bot.save();
      this.emit('bot.ready', botId);
    }
  }

  async disconnectBot(botInstance: IBotInstance) {
    const sock = this.bots.get(botInstance._id.toString());
    if (sock) {
      await sock.logout();
      await sock.end();
      this.bots.delete(botInstance._id.toString());
    }
  }

  async sendMessage(botId: string, to: string, message: string) {
    const sock = this.bots.get(botId);
    if (!sock) throw new Error('Bot not found');
    return await sock.sendMessage(to, { text: message });
  }

  getBot(botId: string) {
    return this.bots.get(botId);
  }

  setupMessageHandler(botId: string, handler: (msg: WhatsAppMessage) => Promise<void>) {
    const sock = this.bots.get(botId);
    if (!sock) return;

    sock.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const message of messages) {
        if (message.key.fromMe) continue;
        await handler(message);
      }
    });
  }
}
