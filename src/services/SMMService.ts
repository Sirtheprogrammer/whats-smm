import axios from 'axios';

class SMMService {
  private api_url: string = 'https://smmguo.com/api/v2';
  private api_key: string;

  constructor(apiKey: string) {
    this.api_key = apiKey;
  }

  async getServices() {
    try {
      const response = await axios.post(this.api_url, {
        key: this.api_key,
        action: 'services'
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch services: ${error}`);
    }
  }

  async createOrder(data: {
    service: number,
    link: string,
    quantity: number
  }) {
    try {
      const response = await axios.post(this.api_url, {
        key: this.api_key,
        action: 'add',
        service: data.service,
        link: data.link,
        quantity: data.quantity
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create order: ${error}`);
    }
  }

  async checkOrderStatus(orderId: string) {
    try {
      const response = await axios.post(this.api_url, {
        key: this.api_key,
        action: 'status',
        order: orderId
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to check order status: ${error}`);
    }
  }

  async getServiceCategories() {
    const services = await this.getServices();
    const categories = new Map();
    
    for (const service of services) {
      const platform = service.platform || 'Other';
      if (!categories.has(platform)) {
        categories.set(platform, new Set());
      }
      categories.get(platform).add(service.category);
    }

    return Object.fromEntries(
      Array.from(categories.entries()).map(([platform, cats]) => [
        platform,
        Array.from(cats)
      ])
    );
  }

  async getServicesByCategory(platform: string, category: string) {
    const services = await this.getServices();
    return services.filter(service => 
      service.platform === platform && 
      service.category === category
    );
  }
}

export default SMMService;
