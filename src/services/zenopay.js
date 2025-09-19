const axios = require('axios');

const ZENOPAY_URL = process.env.ZENOPAY_URL || 'https://zenoapi.com/api/payments/mobile_money_tanzania';
const API_KEY = process.env.ZENOPAY_API_KEY || '';

function formatPhoneToTZ(phone) {
  if (!phone) return '';
  let digits = ('' + phone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  // strip leading '+' if any
  if (digits.startsWith('+')) digits = digits.slice(1);
  // if already starts with 255, return as is
  if (digits.startsWith('255') && digits.length >= 12) {
    return digits.slice(0, 12); // 255 + 9
  }
  // if starts with 0 and length 10 (0XXXXXXXXX), convert to 255XXXXXXXXX
  if (digits.length === 10 && digits.startsWith('0')) {
    return '255' + digits.slice(1);
  }
  // if starts with 9 digits (7XXXXXXXX), prefix 255
  if (digits.length === 9 && digits.startsWith('7')) {
    return '255' + digits;
  }
  // fallback: take last 9 digits and prefix 255
  const last9 = digits.slice(-9);
  return '255' + last9;
}

async function createPayment({ order_id, buyer_name, buyer_phone, buyer_email, amount, webhook_url }) {
  const defaultEmail = process.env.ZENOPAY_DEFAULT_EMAIL || 'admin@codeskytz.site';
  const formattedPhone = formatPhoneToTZ(buyer_phone || '');
  const payload = {
    order_id,
    buyer_name: buyer_name || 'WhatsApp User',
    buyer_phone: formattedPhone,
    buyer_email: buyer_email || defaultEmail,
    amount: amount || 0,
    webhook_url: webhook_url || undefined
  };

  try {
    // debug log
    console.log('[zenopay] initiating payment', { url: ZENOPAY_URL, payload });
    const resp = await axios.post(ZENOPAY_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      timeout: 20000
    });
    console.log('[zenopay] response', resp && resp.data);
    return resp.data;
  } catch (e) {
    if (e.response && e.response.data) {
      console.log('[zenopay] error response', e.response.data);
      return e.response.data;
    }
    console.log('[zenopay] error', e && e.message);
    throw e;
  }
}

module.exports = {
  createPayment,
  formatPhoneToTZ
};
