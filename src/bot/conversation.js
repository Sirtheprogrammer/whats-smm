const Session = require('../models/session');
const SmmService = require('../models/smmService');

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
    const reply = orderId ? `Order ${orderId} not found.` : 'Usage: .status <order_id>';
    return { session: { sessionId, state, data }, reply };
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
      const svc = list[n-1];
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
      data.state = STATES.PAYMENT_PHONE;
      state = STATES.PAYMENT_PHONE;
      await saveSession({ sessionId, state, data });
      const svc = data.selectedService || {};
      const summary = `Order Summary:\n- Service: ${svc.name || ''}\n- Target: ${data.target}\n- Quantity: ${data.quantity}\n- Price per unit: ${svc.price || 'N/A'}`;
      const reply = summary + '\n\nPlease reply with the phone number to receive payment instructions.';
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.PAYMENT_PHONE: {
      const phone = text.replace(/[^0-9+]/g, '');
      if (!phone) return { session: { sessionId, state, data }, reply: 'Please send a valid phone number.' };
      data.paymentPhone = phone;
      data.state = STATES.ORDER_PLACED;
      state = STATES.ORDER_PLACED;
      // here we would create an actual order with the SMM provider; for now store order in session
      data.order = {
        id: 'local-' + Date.now(),
        service: data.selectedService,
        platform: data.platform,
        category: data.category,
        target: data.target,
        quantity: data.quantity,
        phone: data.paymentPhone,
        status: 'PENDING'
      };
      await saveSession({ sessionId, state, data });
      const reply = `Order placed (id: ${data.order.id}). We will process payment & fulfillment shortly. Reply 'menu' to return to main menu.`;
      return { session: { sessionId, state, data }, reply };
    }

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
