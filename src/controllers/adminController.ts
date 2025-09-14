import { Request, Response } from 'express';
import Service from '../models/Service';
import WhatsAppConnection from '../models/WhatsAppConnection';
import WhatsAppBot from '../services/WhatsAppBot';
import SMMService from '../services/SMMService';
import { v4 as uuidv4 } from 'uuid';

export const adminController = {
  // Service Management
  async getAllServices(req: Request, res: Response) {
    try {
      const services = await Service.find().sort({ platform: 1, category: 1 });
      res.json(services);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch services' });
    }
  },

  async syncSMMServices(req: Request, res: Response) {
    try {
      const smmService = new SMMService(process.env.SMMGUO_API_KEY!);
      const services = await smmService.getServices();
      
      for (const service of services) {
        await Service.findOneAndUpdate(
          { serviceId: service.service },
          {
            serviceId: service.service,
            platform: service.platform || 'Other',
            category: service.category,
            name: service.name,
            price: service.rate,
            minOrder: service.min,
            maxOrder: service.max,
            description: service.description,
            isEnabled: false // Default to disabled, admin needs to enable manually
          },
          { upsert: true }
        );
      }
      
      res.json({ message: 'Services synced successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync services' });
    }
  },

  async updateServiceStatus(req: Request, res: Response) {
    try {
      const { serviceId, isEnabled } = req.body;
      const service = await Service.findOneAndUpdate(
        { serviceId },
        { isEnabled },
        { new: true }
      );
      res.json(service);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update service status' });
    }
  },

  // WhatsApp Connection Management
  async getAllConnections(req: Request, res: Response) {
    try {
      const connections = await WhatsAppConnection.find();
      res.json(connections);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch WhatsApp connections' });
    }
  },

  async createConnection(req: Request, res: Response) {
    try {
      const { phoneNumber, name } = req.body;
      
      // Create unique auth path for this connection
      const authPath = `auth_${uuidv4()}`;
      
      // Initialize WhatsApp bot instance
      const whatsappBot = new WhatsAppBot(authPath);
      const pairingCode = await whatsappBot.requestPairingCode(phoneNumber);
      
      // Save connection details
      const connection = await WhatsAppConnection.create({
        phoneNumber,
        name,
        authPath,
        pairingCode,
        status: 'pending'
      });

      res.json(connection);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create WhatsApp connection' });
    }
  },

  async deleteConnection(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await WhatsAppConnection.findByIdAndDelete(id);
      res.json({ message: 'Connection deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete connection' });
    }
  },

  // Dashboard Statistics
  async getDashboardStats(req: Request, res: Response) {
    try {
      const stats = {
        totalServices: await Service.countDocuments(),
        enabledServices: await Service.countDocuments({ isEnabled: true }),
        activeConnections: await WhatsAppConnection.countDocuments({ status: 'connected' }),
        // Add more statistics as needed
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
  }
};
