import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface PaymentRequest {
  buyer_name: string;
  buyer_phone: string;
  amount: number;
  webhook_url: string;
}

class ZenopayService {
  private api_url: string = 'https://zenoapi.com/api/payments';
  private api_key: string;

  constructor(apiKey: string) {
    this.api_key = apiKey;
  }

  async createPayment(data: PaymentRequest) {
    try {
      const orderId = uuidv4();
      const response = await axios.post(
        `${this.api_url}/mobile_money_tanzania`,
        {
          order_id: orderId,
          ...data
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.api_key
          }
        }
      );
      return { ...response.data, orderId };
    } catch (error) {
      throw new Error(`Failed to create payment: ${error}`);
    }
  }

  async checkPaymentStatus(orderId: string) {
    try {
      const response = await axios.get(
        `${this.api_url}/order-status`,
        {
          params: { order_id: orderId },
          headers: { 'x-api-key': this.api_key }
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to check payment status: ${error}`);
    }
  }

  verifyWebhookSignature(headers: any, body: string): boolean {
    // Implement webhook signature verification logic here
    const receivedApiKey = headers['x-api-key'];
    return receivedApiKey === this.api_key;
  }
}

export default ZenopayService;
