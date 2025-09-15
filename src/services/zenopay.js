const axios = require('axios');

const ZENOPAY_URL = process.env.ZENOPAY_URL || 'https://zenoapi.com/api/payments/mobile_money_tanzania';
const API_KEY = process.env.ZENOPAY_API_KEY || '';

function formatPhoneToTZ(phone) {
  if (!phone) return '';
  const digits = ('' + phone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  // handle +2557..., 2557..., 07..., 7...
  if (digits.startsWith('255')) {
    const rest = digits.slice(3);
    return rest.length === 9 ? '0' + rest : '0' + rest.slice(-9);
  }
  if (digits.length === 9 && digits.startsWith('7')) return '0' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  // fallback: use last 9 digits and prefix 0
  const last9 = digits.slice(-9);
  return '0' + last9;
}

async function createPayment({ order_id, buyer_name, buyer_phone, buyer_email, amount, webhook_url }) {
  const defaultEmail = process.env.ZENOPAY_DEFAULT_EMAIL || 'admin@codeskytz.site';
  const payload = {
    order_id,
    buyer_name: buyer_name || 'WhatsApp User',
    buyer_phone: formatPhoneToTZ(buyer_phone || ''),
    buyer_email: buyer_email || defaultEmail,
    amount: amount || 0,
    webhook_url: webhook_url || undefined
  };

  try {
    const resp = await axios.post(ZENOPAY_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      timeout: 20000
    });
    return resp.data;
  } catch (e) {
    if (e.response && e.response.data) return e.response.data;
    throw e;
  }
}

module.exports = {
  createPayment,
  formatPhoneToTZ
};
