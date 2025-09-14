import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin';
import BotInstance from '../models/BotInstance';
import { WhatsAppBotManager } from '../services/WhatsAppBotManager';
import SMMService from '../services/SMMService';

export class AdminController {
  private botManager: WhatsAppBotManager;
  private smmService: SMMService;

  constructor(botManager: WhatsAppBotManager, smmService: SMMService) {
    this.botManager = botManager;
    this.smmService = smmService;
  }

  login = async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      const admin = await Admin.findOne({ username });

      if (!admin || !(await admin.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET!, { expiresIn: '24h' });
      res.json({ token, admin: { username: admin.username, role: admin.role } });
    } catch (error) {
      res.status(500).json({ message: 'Server error' });
    }
  };

  createBotInstance = async (req: Request, res: Response) => {
    try {
      const { name, phoneNumber } = req.body;
      
      const botInstance = new BotInstance({
        name,
        phoneNumber,
        status: 'inactive',
        authPath: `auth_${Date.now()}`
      });

      await botInstance.save();
      res.json(botInstance);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create bot instance' });
    }
  };

  connectBot = async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const botInstance = await BotInstance.findById(botId);

      if (!botInstance) {
        return res.status(404).json({ message: 'Bot instance not found' });
      }

      const pairingCode = await this.botManager.initializeBot(botInstance);
      res.json({ pairingCode });
    } catch (error) {
      res.status(500).json({ message: 'Failed to connect bot' });
    }
  };

  getBotInstances = async (req: Request, res: Response) => {
    try {
      const instances = await BotInstance.find();
      res.json(instances);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch bot instances' });
    }
  };

  updateEnabledServices = async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const { services } = req.body;

      const botInstance = await BotInstance.findByIdAndUpdate(
        botId,
        { enabledServices: services },
        { new: true }
      );

      if (!botInstance) {
        return res.status(404).json({ message: 'Bot instance not found' });
      }

      res.json(botInstance);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update enabled services' });
    }
  };

  getAvailableServices = async (req: Request, res: Response) => {
    try {
      const services = await this.smmService.getServices();
      const categories = await this.smmService.getServiceCategories();
      res.json({ services, categories });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch services' });
    }
  };

  disconnectBot = async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const botInstance = await BotInstance.findById(botId);

      if (!botInstance) {
        return res.status(404).json({ message: 'Bot instance not found' });
      }

      await this.botManager.disconnectBot(botInstance);
      botInstance.status = 'inactive';
      await botInstance.save();

      res.json({ message: 'Bot disconnected successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to disconnect bot' });
    }
  };
}
