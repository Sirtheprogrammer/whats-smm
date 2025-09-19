require('dotenv').config();
const zeno = require('../services/zenopay');

async function run() {
  const orderId = 'local-test-payment-' + Date.now();
  console.log('Initiating payment for order:', orderId);
  try {
    const resp = await zeno.createPayment({
      order_id: orderId,
      buyer_name: 'Test User',
      buyer_phone: process.env.TEST_PHONE || '255793710144',
      buyer_email: process.env.ZENOPAY_DEFAULT_EMAIL || 'admin@codeskytz.site',
      amount: 1000,
      webhook_url: process.env.ZENOPAY_WEBHOOK_URL
    });
    console.log('Zenopay response:', JSON.stringify(resp, null, 2));
  } catch (e) {
    console.error('Payment initiation failed', e);
  }
}

run();
