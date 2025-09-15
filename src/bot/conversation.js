const Session = require('../models/session');
const SmmService = require('../models/smmService');
const smm = require('../services/smmguo');
const Order = require('../models/order');

const STATES = Object.freeze({
  START: 'START',
  PLATFORM_SELECT: 'PLATFORM_SELECT',
  CATEGORY_SELECT: 'CATEGORY_SELECT',
  SERVICE_SELECT: 'SERVICE_SELECT',
  ENTER_LINK: 'ENTER_LINK',
  ENTER_QTY: 'ENTER_QTY',
  PAYMENT_PHONE: 'PAYMENT_PHONE',
  AWAITING_PAY: 'AWAITING_PAY',
  ORDER_PLACED: 'ORDER_PLACED'
});

// in-memory fallback for tests / when DB is unavailable
const inMemoryStore = new Map();

async function loadSession(sessionId) {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) throw new Error('mongoose not connected');

    const doc = await Session.findOne({ sessionId }).lean();
    if (!doc) {
      return { sessionId, state: STATES.START, data: {} };
    }
    return { sessionId: doc.sessionId, state: doc.data?.state || STATES.START, data: doc.data || {} };
  } catch (err) {
    const s = inMemoryStore.get(sessionId);
    if (!s) return { sessionId, state: STATES.START, data: {} };
    return { sessionId, state: s.state || STATES.START, data: s.data || {} };
  }
}

async function saveSession(session) {
  const payload = { sessionId: session.sessionId, data: session.data || { state: session.state }, updatedAt: new Date() };
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) throw new Error('mongoose not connected');
    await Session.updateOne({ sessionId: session.sessionId }, payload, { upsert: true });
  } catch (err) {
    inMemoryStore.set(session.sessionId, { state: session.state, data: session.data });
  }
}

async function getAvailablePlatforms() {
  try {
    const list = await SmmService.distinct('platform');
    if (Array.isArray(list) && list.length) return list;
  } catch (e) {
    // ignore
  }
  // fallback static list
  return [ 'Instagram', 'Twitter / X', 'YouTube', 'TikTok', 'Telegram' ];
}

function formatPlatformsMessage(platforms) {
  const lines = ['*👋 Welcome to CodeSkytz SMM Bot!*', '', '*Choose a platform to get started:*'];
  platforms.forEach((p, i) => lines.push(`${i+1}. *${p}*`));
  lines.push('');
  lines.push('Reply with the number of the platform (e.g. *1* for Instagram).');
  lines.push('Type *.help* for help or *.status <order_id>* to check an order.');
  return lines.join('\n');
}

function helpText() {
  return '*Help — Quick Commands*\n\n' +
    '• Reply with a platform number to start an order.\n' +
    '• *.status <order_id>* — check an order status (stub).\n' +
    '• *.help* — show this help message.\n\n' +
    'Each step will include instructions for what to send next.';
}

async function getCategoriesForPlatform(platform) {
  try {
    const cats = await SmmService.distinct('category', { platform });
    return (cats || []).filter(Boolean).map(c => String(c));
  } catch (e) { return []; }
}

async function getServicesFor(platform, category) {
  try {
    const q = { platform };
    if (category) q.category = category;
    const docs = await SmmService.find(q).limit(200).lean();
    return docs.map(d => ({ id: d.serviceId, name: d.name, price: d.price || null, raw: d.raw || {} }));
  } catch (e) { return []; }
}

// helper: detect whether a service price is given per 1k (1000 units) based on name/raw
function detectPriceUnit(svc) {
  const txt = ((svc && (svc.name || '')) + ' ' + JSON.stringify(svc && svc.raw || {})).toLowerCase();
  // common indicators that the price is per 1k
  if (/\b1k\b/.test(txt) || /\b1000\b/.test(txt) || /per\s*1k/.test(txt) || /per\s*1000/.test(txt) || /\/1k/.test(txt) || /per\s*1,000/.test(txt)) {
    return { multiplier: 1000, unitLabel: 'per 1k' };
  }
  // heuristic: large nominal price and 'follower' term likely means price is per 1k
  const priceVal = Number(svc && svc.price);
  if (Number.isFinite(priceVal) && priceVal > 1000 && /follow(er)?s?/.test(txt)) {
    return { multiplier: 1000, unitLabel: 'per 1k' };
  }
  return { multiplier: 1, unitLabel: 'per unit' };
}

// Main handler
async function handleIncoming(sessionId, text) {
  text = (text || '').trim();
  const session = await loadSession(sessionId);
  let { state, data } = session;
  data = data || {};
  const lower = (text || '').toLowerCase();

  // Global quick commands
  if (lower === 'back' || lower === 'cancel' || lower === 'menu') {
    const platforms = await getAvailablePlatforms();
    const reply = formatPlatformsMessage(platforms);
    state = STATES.PLATFORM_SELECT;
    data = { state };
    await saveSession({ sessionId, state, data });
    return { session: { sessionId, state, data }, reply };
  }

  if (lower.startsWith('.status')) {
    const parts = text.split(/\s+/);
    const orderId = parts[1];
    if (!orderId) {
      return { session: { sessionId, state, data }, reply: 'Usage: .status <order_id>\nExample: .status local-1590000000000' };
    }
    try {
      const order = await Order.findOne({ orderId }).lean();
      if (!order) {
        return { session: { sessionId, state, data }, reply: `Order ${orderId} not found.` };
      }
      const lines = [];
      lines.push(`Order: ${order.orderId}`);
      lines.push(`Status: ${order.status}`);
      if (order.serviceName) lines.push(`Service: ${order.serviceName}`);
      if (order.platform) lines.push(`Platform: ${order.platform}`);
      if (order.target) lines.push(`Target: ${order.target}`);
      if (Number.isFinite(order.quantity)) lines.push(`Quantity: ${order.quantity}`);
      if (Number.isFinite(order.rawPrice)) lines.push(`Price (listed): ${order.rawPrice} TZS`);
      if (Number.isFinite(order.pricePerUnit)) lines.push(`Price per unit: ${Number(order.pricePerUnit.toFixed(2))} TZS`);
      if (Number.isFinite(order.amount_due_tzs)) lines.push(`Amount due: ${Number(order.amount_due_tzs.toFixed(2))} TZS`);
      if (order.paymentPhone) lines.push(`Payment phone: ${order.paymentPhone}`);
      if (order.providerResponse) lines.push(`Provider info: ${JSON.stringify(order.providerResponse).slice(0, 200)}`);
      const reply = lines.join('\n');
      return { session: { sessionId, state, data }, reply };
    } catch (e) {
      return { session: { sessionId, state, data }, reply: 'Error fetching order status. Please try again later.' };
    }
  }

  if (lower === '.help' || lower === 'help') {
    return { session: { sessionId, state, data }, reply: helpText() };
  }

  switch (state) {
    case STATES.START: {
      const platforms = await getAvailablePlatforms();
      const reply = formatPlatformsMessage(platforms);
      state = STATES.PLATFORM_SELECT;
      data = { state, platforms };
      await saveSession({ sessionId, state, data });
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.PLATFORM_SELECT: {
      const n = Number(text);
      const platforms = data.platforms || await getAvailablePlatforms();
      if (!Number.isInteger(n) || n < 1 || n > platforms.length) {
        const reply = 'Invalid choice. Reply with platform number from the list.';
        return { session: { sessionId, state, data }, reply };
      }
      const chosen = platforms[n-1];
      state = STATES.CATEGORY_SELECT;
      const categories = await getCategoriesForPlatform(chosen);
      data = { state, platform: chosen, categories };
      await saveSession({ sessionId, state, data });
      if (!categories.length) {
        // if no categories, jump to services list
        const services = await getServicesFor(chosen, null);
        data.servicesList = services;
        data.state = STATES.SERVICE_SELECT;
        state = STATES.SERVICE_SELECT;
        await saveSession({ sessionId, state, data });
        const lines = ['No categories found. Available services:'];
        services.forEach((s,i) => lines.push(`${i+1}. ${s.name}${s.price?(' - '+s.price):''}`));
        lines.push('\nReply with the service number to select.');
        return { session: { sessionId, state, data }, reply: lines.join('\n') };
      }
      const lines = ['Choose a category:'];
      categories.forEach((c,i) => lines.push(`${i+1}. ${c}`));
      lines.push('\nReply with the category number.');
      return { session: { sessionId, state, data }, reply: lines.join('\n') };
    }

    case STATES.CATEGORY_SELECT: {
      const n = Number(text);
      const categories = data.categories || [];
      if (!Number.isInteger(n) || n < 1 || n > categories.length) {
        return { session: { sessionId, state, data }, reply: 'Invalid category. Reply with its number.' };
      }
      const chosenCat = categories[n-1];
      const platform = data.platform;
      const services = await getServicesFor(platform, chosenCat);
      if (!services.length) return { session: { sessionId, state, data }, reply: 'No services found for that category.' };
      // store services list in session for indexing by number
      data = { state: STATES.SERVICE_SELECT, platform, category: chosenCat, servicesList: services };
      state = STATES.SERVICE_SELECT;
      await saveSession({ sessionId, state, data });
      const lines = [`Services for ${chosenCat}:`];
      services.forEach((s,i) => lines.push(`${i+1}. ${s.name}${s.price?(' - '+s.price):''}`));
      lines.push('\nReply with the service number to select.');
      return { session: { sessionId, state, data }, reply: lines.join('\n') };
    }

    case STATES.SERVICE_select: // accidental old constant fallback
    case STATES.SERVICE_SELECT: {
      const n = Number(text);
      const list = data.servicesList || [];
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        return { session: { sessionId, state, data }, reply: 'Invalid service selection. Reply with the number.' };
      }
      let svc = list[n-1];
      // try to enrich price if missing
      if (!svc.price) {
        try {
          // first try local DB lookup (in case list items lacked price)
          const dbItem = await SmmService.findOne({ serviceId: svc.id }).lean().catch(()=>null);
          if (dbItem && dbItem.price) {
            svc.price = dbItem.price;
          } else {
            // fallback to remote provider fetch
            const remote = await smm.getServiceById(svc.id).catch(()=>null);
            if (remote && (remote.price || remote.rate)) svc.price = remote.price || remote.rate;
          }
        } catch (e) {
          // ignore enrichment errors
        }
      }
      data.selectedService = svc;
      data.state = STATES.ENTER_LINK;
      state = STATES.ENTER_LINK;
      await saveSession({ sessionId, state, data });
      const reply = `You selected *${svc.name}*${svc.price?(' - '+svc.price):''}.\nPlease send the target link or username (e.g. https://instagram.com/username).`;
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.ENTER_LINK: {
      if (!text) return { session: { sessionId, state, data }, reply: 'Please send the target link or username.' };
      data.target = text;
      data.state = STATES.ENTER_QTY;
      state = STATES.ENTER_QTY;
      await saveSession({ sessionId, state, data });
      const reply = 'Enter the quantity you want to purchase (numbers only).';
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.ENTER_QTY: {
      const qty = Number(text);
      if (!Number.isInteger(qty) || qty <= 0) return { session: { sessionId, state, data }, reply: 'Please enter a valid quantity (number).' };
      data.quantity = qty;

      // compute pricing correctly: if price is per 1k, convert to per-unit
      const svc = data.selectedService || {};
      const rawPrice = parseFloat(svc.price) || 0;
      const { multiplier, unitLabel } = detectPriceUnit(svc);
      const pricePerUnit = multiplier > 1 ? (rawPrice / multiplier) : rawPrice;
      const total = pricePerUnit * Number(data.quantity);

      // store computed values for later (payment step)
      data.priceUnitMultiplier = multiplier;
      data.priceUnitLabel = unitLabel;
      data.rawPrice = rawPrice; // original displayed price (e.g. per 1k)
      data.pricePerUnit = pricePerUnit;
      data.estimatedTotal = total;

      data.state = STATES.PAYMENT_PHONE;
      state = STATES.PAYMENT_PHONE;
      await saveSession({ sessionId, state, data });

      const pricePerUnitDisplay = pricePerUnit ? Number(pricePerUnit.toFixed(2)) : 'N/A';
      const rawPriceDisplay = rawPrice ? Number(rawPrice.toFixed(2)) : 'N/A';
      let summaryLines = [
        `Order Summary:`,
        `- Service: ${svc.name || ''}`,
        `- Target: ${data.target}`,
        `- Quantity: ${data.quantity}`
      ];

      if (rawPrice) {
        if (multiplier > 1) {
          summaryLines.push(`- Price per ${unitLabel}: ${rawPriceDisplay} TZS`);
          summaryLines.push(`- Price per unit: ${pricePerUnitDisplay} TZS`);
        } else {
          summaryLines.push(`- Price per unit: ${rawPriceDisplay} TZS`);
        }
      } else {
        summaryLines.push(`- Price per unit: N/A`);
      }

      summaryLines.push(`- Estimated total: ${Number(total.toFixed(2))} TZS`);

      const summary = summaryLines.join('\n');
      const reply = summary + '\n\nPlease reply with the phone number to receive payment instructions.';
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.PAYMENT_PHONE: {
      const phone = text.replace(/[^0-9+]/g, '');
      if (!phone) return { session: { sessionId, state, data }, reply: 'Please send a valid phone number.' };
      data.paymentPhone = phone;
      data.state = STATES.ORDER_PLACED;
      state = STATES.ORDER_PLACED;

      // create persistent order
      const orderObj = {
        orderId: 'local-' + Date.now(),
        sessionId,
        serviceId: data.selectedService && data.selectedService.id,
        serviceName: data.selectedService && data.selectedService.name,
        platform: data.platform,
        category: data.category,
        target: data.target,
        quantity: data.quantity,
        pricePerUnit: data.pricePerUnit,
        rawPrice: data.rawPrice,
        priceUnitMultiplier: data.priceUnitMultiplier || 1,
        amount_due_tzs: Number((data.estimatedTotal || 0).toFixed(2)),
        paymentPhone: data.paymentPhone,
        status: 'PENDING'
      };
      try {
        const saved = await Order.create(orderObj);
        data.order = { id: saved.orderId, _id: saved._id, status: saved.status };
      } catch (e) {
        // fallback to session-only order if DB failed
        data.order = { id: orderObj.orderId, status: 'PENDING' };
      }

      // initiate payment via ZenoPay (USSD push)
      try {
        const zeno = require('../services/zenopay');
        const payResp = await zeno.createPayment({
          order_id: data.order.id,
          buyer_name: sessionId,
          buyer_phone: data.paymentPhone,
          amount: orderObj.amount_due_tzs,
          webhook_url: process.env.ZENOPAY_WEBHOOK_URL || (process.env.WEBHOOK_URL || '')
        });

        // update order with payment initiation
        try {
          await Order.updateOne({ orderId: data.order.id }, { $set: { paymentInitiation: payResp, status: payResp && payResp.resultcode === '000' ? 'PROCESSING_PAYMENT' : 'PENDING' } }).catch(()=>{});
          await Session.updateOne({ sessionId }, { $set: { 'data.order.paymentInitiation': payResp, 'data.order.status': payResp && payResp.resultcode === '000' ? 'PROCESSING_PAYMENT' : 'PENDING' } }).catch(()=>{});
        } catch (e) {}

        if (payResp && payResp.resultcode === '000') {
          const reply = `Payment request sent via ZenoPay. You should receive a prompt on ${data.paymentPhone}. After successful payment we will automatically place your order. Order ID: ${data.order.id}`;
          await saveSession({ sessionId, state, data });
          return { session: { sessionId, state, data }, reply };
        } else {
          const reply = `Failed to initiate payment: ${JSON.stringify(payResp)}. Admin will be notified.`;
          await saveSession({ sessionId, state, data });
          return { session: { sessionId, state, data }, reply };
        }
      } catch (e) {
        await saveSession({ sessionId, state, data });
        return { session: { sessionId, state, data }, reply: 'Failed to initiate payment. Please try again later.' };
      }

    } // <-- close PAYMENT_PHONE case

    default: {
      return { session: { sessionId, state, data }, reply: 'Sorry, I did not understand that. Type *.help* for options.' };
    }
  }
}

module.exports = {
  STATES,
  handleIncoming,
  // keep a convenience function for testing
  getAvailablePlatforms
};
