import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { WhatsAppBotManager } from './services/WhatsAppBotManager';
import SMMService from './services/SMMService';
import ZenopayService from './services/ZenopayService';
import ConversationHandler from './services/ConversationHandler';
import { AdminController } from './controllers/AdminController';
import { createAdminRouter } from './routes/admin';
import BotInstance from './models/BotInstance';
import Order from './models/Order';
import User from './models/User';
import { WhatsAppMessage } from './types/WhatsApp';
import adminRoutes from './routes/adminRoutes';
import WhatsAppConnection from './models/WhatsAppConnection';
import Service from './models/Service';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize services
const smmService = new SMMService(process.env.SMMGUO_API_KEY!);
const zenopayService = new ZenopayService(process.env.ZENOPAY_API_KEY!);
const conversationHandler = new ConversationHandler(smmService, zenopayService);

// Map to store active WhatsApp connections
const whatsappBotManager = new WhatsAppBotManager();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI!)
  .then(() => {
    console.log('Connected to MongoDB');
    initializeWhatsAppConnections();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Initialize all stored WhatsApp connections
async function initializeWhatsAppConnections() {
  const connections = await WhatsAppConnection.find({ status: { $ne: 'disconnected' } });
  
  for (const connection of connections) {
    const bot = new WhatsAppBot(connection.authPath);
    await bot.initialize();
    
    bot.on('message', async ({ chatId, messageText }) => {
      try {
        if (messageText.startsWith('.')) {
          const [command, ...params] = messageText.split(' ');
          const response = await conversationHandler.handleCommand(chatId, command, params);
          await bot.sendMessage(chatId, response);
        } else {
          const response = await conversationHandler.handleMessage(chatId, messageText);
          await bot.sendMessage(chatId, response);
        }
      } catch (error) {
        console.error('Error handling message:', error);
        await bot.sendMessage(chatId, 'An error occurred. Please try again.');
      }
    });

    activeConnections.set(connection.authPath, bot);
  }
}

// Admin routes
app.use('/api/admin', adminRoutes);

// Zenopay webhook endpoint
app.post('/webhook/payment', async (req, res) => {
  const signature = req.headers['x-api-key'];
  if (!zenopayService.verifyWebhookSignature(req.headers, JSON.stringify(req.body))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { order_id, payment_status } = req.body;

  if (payment_status === 'COMPLETED') {
    try {
      const order = await Order.findOne({ 'payment.orderId': order_id }).populate('userId');
      if (order) {
        order.paymentStatus = 'completed';
        order.paymentReference = req.body.reference;
        
        // Get the service from our database
        const service = await Service.findOne({ serviceId: order.service.id });
        if (!service || !service.isEnabled) {
          throw new Error('Service is not available');
        }

        // Create SMM order
        const smmOrder = await smmService.createOrder({
          service: parseInt(order.service.id),
          link: order.link,
          quantity: order.quantity
        });

        order.smmOrderId = smmOrder.order;
        order.status = 'processing';
        await order.save();

        // Find the appropriate WhatsApp connection
        const connection = await WhatsAppConnection.findOne({ phoneNumber: order.userId.whatsappId });
        if (connection && activeConnections.has(connection.authPath)) {
          const bot = activeConnections.get(connection.authPath);
          await bot?.sendMessage(
            order.userId.whatsappId,
            `Payment received! Your order ${order.smmOrderId} has been placed and is being processed.`
          );
        }
      }
    } catch (error) {
      console.error('Error processing payment webhook:', error);
    }
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
