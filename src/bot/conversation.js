const Session = require('../models/session');

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

const PLATFORMS = [
  'Instagram',
  'Twitter / X',
  'YouTube',
  'TikTok',
  'Telegram'
];

// in-memory fallback for tests / when DB is unavailable
const inMemoryStore = new Map();

async function loadSession(sessionId) {
  try {
    // if mongoose not connected, fallback
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) throw new Error('mongoose not connected');

    const doc = await Session.findOne({ sessionId }).lean();
    if (!doc) {
      return { sessionId, state: STATES.START, data: {} };
    }
    return { sessionId: doc.sessionId, state: doc.data?.state || STATES.START, data: doc.data || {} };
  } catch (err) {
    // fallback to in-memory
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
    // fallback to in-memory
    inMemoryStore.set(session.sessionId, { state: session.state, data: session.data });
  }
}

function welcomeMessage() {
  const lines = [];
  lines.push('*👋 Welcome to CodeSkytz SMM Bot!*');
  lines.push('');
  lines.push('*Choose a platform to get started:*');
  PLATFORMS.forEach((p, i) => lines.push(`${i + 1}. *${p}*`));
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

async function handleIncoming(sessionId, text) {
  text = (text || '').trim();

  const session = await loadSession(sessionId);
  let { state, data } = session;

  // normalize input
  const lower = (text || '').toLowerCase();

  // Global quick commands: back / cancel / menu => return to platform selection (main menu)
  if (lower === 'back' || lower === 'cancel' || lower === 'menu') {
    state = STATES.PLATFORM_SELECT;
    data = { ...data, state };
    await saveSession({ sessionId, state, data });
    const reply = welcomeMessage();
    return { session: { sessionId, state, data }, reply };
  }

  // Commands available anytime
  if (lower.startsWith('.status')) {
    const parts = text.split(/\s+/);
    const orderId = parts[1];
    // stub: no orders yet
    const reply = orderId ? `Order ${orderId} not found.` : 'Usage: .status <order_id>'; 
    // do not change state
    return { session: { sessionId, state, data }, reply };
  }

  if (lower === '.help' || lower === 'help') {
    return { session: { sessionId, state, data }, reply: helpText() };
  }

  switch (state) {
    case STATES.START: {
      const reply = welcomeMessage();
      state = STATES.PLATFORM_SELECT;
      data = { ...data, state };
      await saveSession({ sessionId, state, data });
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.PLATFORM_SELECT: {
      // Expect a number 1..N
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > PLATFORMS.length) {
        const reply = 'Invalid choice. Please reply with the number of the platform from the list (e.g. *1* for Instagram).';
        return { session: { sessionId, state, data }, reply };
      }
      const chosen = PLATFORMS[n - 1];
      data = { ...data, platform: chosen };
      state = STATES.CATEGORY_SELECT;
      data.state = state;
      await saveSession({ sessionId, state, data });
      const reply = `*${chosen}* selected. What would you like to do next?\n\n` +
        '1. Buy followers/likes\n' +
        '2. Buy views\n' +
        '3. Other services\n\n' +
        'Reply with the number of the option.';
      return { session: { sessionId, state, data }, reply };
    }

    default: {
      const reply = 'Sorry, I did not understand that. Type *.help* for options.';
      return { session: { sessionId, state, data }, reply };
    }
  }
}

module.exports = {
  STATES,
  handleIncoming,
  welcomeMessage,
  PLATFORMS
};
