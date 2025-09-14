import { EventEmitter } from 'events';
import User from '../models/User';
import Order from '../models/Order';
import SMMService from './SMMService';
import ZenopayService from './ZenopayService';
import { WhatsAppMessage } from '../types/WhatsApp';

interface UserState {
  step: string;
  platform?: string;
  category?: string;
  service?: any;
  link?: string;
  quantity?: number;
  amount?: number;
}

class ConversationHandler extends EventEmitter {
  private userStates: Map<string, UserState>;
  private smmService: SMMService;
  private zenopayService: ZenopayService;

  constructor(smmService: SMMService, zenopayService: ZenopayService) {
    super();
    this.userStates = new Map();
    this.smmService = smmService;
    this.zenopayService = zenopayService;
  }

  async handleMessage(userId: string, message: string) {
    let state = this.userStates.get(userId) || { step: 'start' };
    let response: string;

    switch (state.step) {
      case 'start':
        const platforms = await this.smmService.getServiceCategories();
        response = 'Welcome to SMM Bot! 🚀\nPlease choose a platform:\n\n';
        Object.keys(platforms).forEach((platform, index) => {
          response += `${index + 1}. ${platform}\n`;
        });
        state.step = 'select_platform';
        break;

      case 'select_platform':
        const platforms = await this.smmService.getServiceCategories();
        const platformIndex = parseInt(message) - 1;
        const platformNames = Object.keys(platforms);
        
        if (platformIndex >= 0 && platformIndex < platformNames.length) {
          state.platform = platformNames[platformIndex];
          state.step = 'select_category';
          
          const categories = platforms[state.platform];
          response = `Please select a category for ${state.platform}:\n\n`;
          categories.forEach((category: string, index: number) => {
            response += `${index + 1}. ${category}\n`;
          });
        } else {
          response = 'Invalid selection. Please choose a valid platform number.';
        }
        break;

      case 'select_category':
        if (state.platform) {
          const platforms = await this.smmService.getServiceCategories();
          const categoryIndex = parseInt(message) - 1;
          const categories = platforms[state.platform];
          
          if (categoryIndex >= 0 && categoryIndex < categories.length) {
            state.category = categories[categoryIndex];
            state.step = 'select_service';
            
            const services = await this.smmService.getServicesByCategory(
              state.platform,
              state.category
            );
            
            response = `Please select a service:\n\n`;
            services.forEach((service: any, index: number) => {
              response += `${index + 1}. ${service.name} - $${service.rate}/1000\n`;
            });
          } else {
            response = 'Invalid selection. Please choose a valid category number.';
          }
        } else {
          response = 'Something went wrong. Please start over.';
          state = { step: 'start' };
        }
        break;

      // ... Add other conversation steps

      default:
        response = 'Something went wrong. Please start over.';
        state = { step: 'start' };
    }

    this.userStates.set(userId, state);
    return response;
  }

  async handleCommand(userId: string, command: string, params: string[]) {
    if (command === '.status') {
      if (params.length === 0) {
        return 'Please provide an order ID. Usage: .status <order_id>';
      }

      const orderId = params[0];
      try {
        const order = await Order.findOne({ smmOrderId: orderId });
        if (!order) {
          return 'Order not found.';
        }

        const status = await this.smmService.checkOrderStatus(orderId);
        return `Order Status:\nID: ${orderId}\nStatus: ${status.status}\nQuantity: ${status.remains}/${status.quantity}`;
      } catch (error) {
        return 'Failed to fetch order status. Please try again later.';
      }
    }

    return 'Unknown command.';
  }
}

export default ConversationHandler;
