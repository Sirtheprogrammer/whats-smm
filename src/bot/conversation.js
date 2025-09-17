const Session = require('../models/session');
const SmmService = require('../models/smmService');
const smm = require('../services/smmguo');
const Order = require('../models/order');
const User = require('../models/user');

// lazy load whatsapp bot to avoid circular require during module initialization
let _waInstance = null;
function getWhatsApp() {
  if (!_waInstance) _waInstance = require('./whatsapp');
  return _waInstance;
}

const PAGE_SIZE = Number(process.env.SERVICES_PAGE_SIZE) || 8;

function parseServicePageToken(id) {
  // id is encoded like encodeURIComponent(`${platform}||${category}||${page}`)
  try {
    const decoded = decodeURIComponent(id || '');
    const parts = decoded.split('||');
    return { platform: parts[0] || '', category: parts[1] || '', page: Number(parts[2] || 1) };
  } catch (e) { return null; }
}

async function sendServicePage(sessionId, services, platform, category, page) {
  // send a plain-text paginated services page to ensure clients see it
  page = Number(page) || 1;
  const plain = buildPlainServicePage(services, platform, category, page);
  try {
    const wa = getWhatsApp();
    if (wa && wa.sendMessage) {
      // attempt to send via WhatsApp socket; if that succeeds return the response
      const resp = await wa.sendMessage(sessionId, plain).catch(()=>null);
      if (resp) return resp;
    }
  } catch (e) {
    // ignore send errors and fallthrough to return plain text
  }
  // return the plain text so caller can use it as a reply if needed
  return plain;
}

function safeText(t, max) {
  if (!t && t !== 0) return '';
  const s = String(t);
  if (s.length <= (max || 24)) return s;
  return s.slice(0, (max || 24) - 1) + '…';
}

// i18n dictionary (English + Swahili)
const I18N = {
  en: {
    choose_language_header: 'Choose language / Chagua lugha',
    choose_language_prompt: 'Reply with 1 for English or 2 for Swahili (Kiswahili).',
    available_platforms: 'Available Platforms:',
    commands_label: 'Commands:',
    how_to_interact: 'How to interact: Reply with the number or the id shown after each item.',
    happy_selling: 'Happy selling! 🚀',
    help_title: 'HELP — QUICK COMMANDS',
    help_ordering_1: 'Send a platform number to browse services.',
    help_ordering_2: 'Send a service number to select it.',
    help_ordering_3: 'Provide target link and quantity when prompted.',
    help_ordering_4: 'Provide phone for payment when asked.',
    choose_category: 'Choose a category:',
    reply_with_category: 'Reply with the category number.',
    invalid_choice_platform: 'Invalid choice. Reply with platform number from the list.',
    invalid_category: 'Invalid category. Reply with its number.',
    no_services_found: 'No services found for that selection.',
    selected_service_prompt: 'You selected *{name}*{price}.\nPlease send the target link or username (e.g. https://instagram.com/username).',
    enter_quantity: 'Enter the quantity you want to purchase (numbers only).',
    invalid_quantity: 'Please enter a valid quantity (number).',
    order_summary_heading: 'Order Summary:',
    price_per_unit_label: 'Price per unit',
    estimated_total_label: 'Estimated total',
    payment_phone_prompt: 'Please reply with the phone number to receive payment instructions.',
    invalid_phone: 'Please send a valid phone number.',
    payment_initiated: 'Payment request sent via ZenoPay. You should receive a prompt on {phone}. After successful payment we will automatically place your order. Order ID: {orderId}',
    failed_payment_initiation: 'Failed to initiate payment: {err}. Admin will be notified.',
    retry_no_order: 'No recent failed order found to retry. You can retry by sending: retry <order_id>',
    retry_no_phone: 'Order does not have a payment phone saved. Please provide a phone number first.',
    payment_reinitiated: 'Payment re-initiated. You should receive a prompt on {phone}. Order ID: {orderId}',
    referral_recorded: 'Referral recorded. You were referred by {phone}.',
    referral_already: 'You already have a referrer recorded: {phone}',
    referral_invalid_phone: 'Invalid phone number for referral.',
    referral_usage: 'Usage: referral <phone>. Example: referral 2557XXXXXXXX',
    my_code_text: 'Your referral code: *{code}*\nShare this link with friends:\n{link}\nYou earn TZS 100 when they complete their first successful order. Withdraw at TZS 5000.',
    no_referrals: 'No referrals yet. Generate your referral code with "my code".',
    referrals_list: 'Your referrals: {count} (total earned: TZS {balance})',
    withdrawal_requested: 'Withdrawal requested for TZS {amt}. Remaining balance: TZS {bal}. Our admin will process the payout.',
    withdraw_minimum: 'Minimum balance for withdrawal is TZS 5000.',
    withdraw_invalid_amount: 'Usage: withdraw <amount>. Amount must be a positive number.',
    balance_display: 'Your referral balance: TZS {bal}. You can withdraw when balance >= TZS 5000.',
    unknown_command: 'Sorry, I did not understand that. Type *.help* for options.'
  },
  sw: {
    choose_language_header: 'Chagua Lugha / Choose language',
    choose_language_prompt: 'Jibu kwa 1 kwa Kiingereza au 2 kwa Kiswahili.',
    available_platforms: 'Majukwaa yanayopatikana:',
    commands_label: 'Amri:',
    how_to_interact: 'Jinsi ya kuingiliana: Jibu kwa nambari au id iliyoonyeshwa kwa kila kipengee.',
    happy_selling: 'Kuuza kwa heri! 🚀',
    help_title: 'USAHAU — AMRI KUFUPI',
    help_ordering_1: 'Tuma nambari ya jukwaa kuangalia huduma.',
    help_ordering_2: 'Tuma nambari ya huduma kuchagua.',
    help_ordering_3: 'Toa link ya lengo na kiasi unachotaka wakati unaombwa.',
    help_ordering_4: 'Toa namba ya simu kwa malipo wakati utaombwa.',
    choose_category: 'Chagua kategoria:',
    reply_with_category: 'Jibu kwa nambari ya kategoria.',
    invalid_choice_platform: 'Chaguo si sahihi. Jibu kwa nambari ya jukwaa kutoka kwenye orodha.',
    invalid_category: 'Kategoria si sahihi. Jibu kwa nambari yake.',
    no_services_found: 'Hakuna huduma zilizopatikana kwa chaguo hilo.',
    selected_service_prompt: 'Umechagua *{name}*{price}.\nTuma link ya lengo au jina la mtumiaji (mfano: https://instagram.com/username).',
    enter_quantity: 'Weka kiasi unachotaka kununua (nambari tu).',
    invalid_quantity: 'Tafadhali weka kiasi sahihi (nambari).',
    order_summary_heading: 'Muhtasari wa Oda:',
    price_per_unit_label: 'Bei kwa kila kitengo',
    estimated_total_label: 'Jumla (makadirio)',
    payment_phone_prompt: 'Tafadhali jibu kwa namba ya simu ili kupokea maagizo ya malipo.',
    invalid_phone: 'Tafadhali tuma namba sahihi ya simu.',
    payment_initiated: 'Ombi la malipo limetumwa kupitia ZenoPay. Utapokea taarifa kwenye {phone}. Baada ya malipo mafanikio tutaweka oda yako moja kwa moja. Order ID: {orderId}',
    failed_payment_initiation: 'Imeshindikana kuanzisha malipo: {err}. Msimamizi ataarifiwa.',
    retry_no_order: 'Hakuna oda iliyoshindikana hivi karibuni ya kurudia. Unaweza kurudia kwa kutuma: retry <order_id>',
    retry_no_phone: 'Oda haina namba ya malipo. Tafadhali toa namba ya simu kwanza.',
    payment_reinitiated: 'Malipo yameanzishwa tena. Utapokea taarifa kwenye {phone}. Order ID: {orderId}',
    referral_recorded: 'Referral imehifadhiwa. Ume-referred na {phone}.',
    referral_already: 'Tayari una referee aliyerekodiwa: {phone}',
    referral_invalid_phone: 'Nambari ya simu ya referral si sahihi.',
    referral_usage: 'Matumizi: referral <phone>. Mfano: referral 2557XXXXXXXX',
    my_code_text: 'Nambari yako ya referral: *{code}*\nShiriki link hii na marafiki:\n{link}\nUnapata TZS 100 wakati wanakamilisha oda yao ya kwanza. Toa wakati TZS 5000.',
    no_referrals: 'Hakuna referrals bado. Tengeneza nambari yako ya referral kwa "my code".',
    referrals_list: 'Referrals zako: {count} (jumla uliyo pata: TZS {balance})',
    withdrawal_requested: 'Ombi la kutoa TZS {amt} limeombwa. Salio lililobaki: TZS {bal}. Msimamizi wetu atashughulikia malipo.',
    withdraw_minimum: 'Salio la chini la kutoa ni TZS 5000.',
    withdraw_invalid_amount: 'Matumizi: withdraw <amount>. Kiasi lazima kiwe namba chanya.',
    balance_display: 'Salio lako la referral: TZS {bal}. Unaweza kutoa wakati salio >= TZS 5000.',
    unknown_command: 'Samahani, sikuelewa. Andika *.help* kwa chaguzi.'
  }
};

function t(key, lang, vars) {
  lang = lang || 'en';
  const dict = I18N[lang] || I18N.en;
  let s = dict[key] || I18N.en[key] || key;
  if (vars && typeof vars === 'object') {
    Object.keys(vars).forEach(k => { s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k])); });
  }
  return s;
}

// extend STATES with LANGUAGE_SELECT
const STATES = Object.freeze({
  START: 'START',
  LANGUAGE_SELECT: 'LANGUAGE_SELECT',
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

function formatPlatformsMessage(platforms, lang) {
  const header = [
    '╔' + '═'.repeat(58) + '╗',
    '║' + ' '.repeat(58) + '║',
    '║' + '      CODESKYTZ SMM BOT'.padEnd(46) + '     ║',
    '║' + ' '.repeat(58) + '║',
    '╚' + '═'.repeat(58) + '╝',
    ''
  ].join('\n');

  const lines = [header, t('available_platforms', lang), ''];
  platforms.forEach((p, i) => lines.push(`${i+1}. ${p}`));
  lines.push('');

  lines.push(t('commands_label', lang));
  lines.push('  • Reply with the platform number to start ordering (e.g. 1)');
  lines.push('  • Reply with a service number when shown (e.g. 2)');
  lines.push('  • my code  — show your referral code & share link');
  lines.push('  • referrals / my referrals — list users you referred');
  lines.push('  • referral <phone> — manually register who referred you');
  lines.push('  • balance — show your referral balance');
  lines.push('  • withdraw <amount> — request payout when balance >= 5000');
  lines.push('  • retry <order_id> — retry a failed payment/order');
  lines.push('  • .status <order_id> — check order status');
  lines.push('  • .help or help — show this help menu');
  lines.push('  • menu / back / cancel — return to this menu');
  lines.push('');
  lines.push(t('how_to_interact', lang));
  lines.push('');
  lines.push(t('happy_selling', lang));

  return lines.join('\n');
}

// rename the non-i18n helpText to avoid duplicate declaration
function helpText_fallback() {
  const lines = [];
  lines.push('╔' + '═'.repeat(46) + '╗');
  lines.push('║' + ` ${t('help_title', 'en')}`.padEnd(44) + '║');
  lines.push('╚' + '═'.repeat(46) + '╝');
  lines.push('');
  lines.push('• Ordering');
  lines.push('   1) Send a platform number to browse services.');
  lines.push('   2) Send a service number to select it.');
  lines.push('   3) Provide target link and quantity when prompted.');
  lines.push('   4) Provide phone for payment when asked.');
  lines.push('');
  lines.push('• Payments');
  lines.push('   • After payment completes we will auto-submit your order.');
  lines.push('   • If payment fails, reply with: retry <order_id>');
  lines.push('');
  lines.push('• Referrals & Wallet');
  lines.push('   • my code — get your referral code & share link');
  lines.push('   • referrals — list users you referred');
  lines.push('   • balance — check referral balance');
  lines.push('   • withdraw <amount> — request payout (min balance TZS 5000)');
  lines.push('');
  lines.push('• Other');
  lines.push('   • .status <order_id> — check order status');
  lines.push('   • .help — show this help');
  lines.push('');
  lines.push('If you need assistance, type *.help* or contact admin.');
  return lines.join('\n');
}

// rename the non-i18n service page builder to avoid conflict with localized version
function buildPlainServicePage_fallback(services, platform, category, page) {
  page = Number(page) || 1;
  const total = Array.isArray(services) ? services.length : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = (services || []).slice(start, start + PAGE_SIZE);

  const lines = [];
  lines.push('┌' + '─'.repeat(56) + '┐');
  lines.push('│ ' + `Services — ${category || platform || ''}`.padEnd(54) + '│');
  lines.push('├' + '─'.repeat(56) + '┤');

  let counter = start + 1;
  for (const s of pageItems) {
    const name = safeText(s.name || s.title || s.id || '', 40);
    const price = s.price ? ` | ${s.price} TZS` : '';
    const rowId = `svc:${encodeURIComponent(s.id || s.serviceId || s.name || String(counter))}`;
    lines.push(`${String(counter).padStart(2)}. ${name}${price}`);
    lines.push(`    id: ${rowId}`);
    lines.push('    ' + '-'.repeat(48));
    counter++;
  }

  if (pages > 1) {
    lines.push(`Page ${page}/${pages} — reply with svc_page:${encodeURIComponent(`${platform||''}||${category||''}||${page+1}`)} for next page`);
  }

  lines.push('Reply with the service number to select, or reply with the id.');
  lines.push('└' + '─'.repeat(56) + '┘');
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

  // language selection prompt: if at start and language not set, ask now
  if (state === STATES.START && (!data || !data.language)) {
    state = STATES.LANGUAGE_SELECT;
    data = { state, language: null };
    await saveSession({ sessionId, state, data });
    const lines = [];
    lines.push('╔' + '═'.repeat(46) + '╗');
    lines.push('║' + ` ${t('choose_language_header', 'en')}`.padEnd(44) + '║');
    lines.push('╚' + '═'.repeat(46) + '╝');
    lines.push('');
    lines.push(t('choose_language_prompt', 'en'));
    lines.push('1. English');
    lines.push('2. Kiswahili');
    return { session: { sessionId, state, data }, reply: lines.join('\n') };
  }

  // if user is responding to language selection
  if (state === STATES.LANGUAGE_SELECT) {
    const choice = text.trim();
    const mapped = (choice === '1' || /^(en|english)$/i.test(choice)) ? 'en' : ((choice === '2' || /^(sw|swahili|kiswahili)$/i.test(choice)) ? 'sw' : null);
    if (!mapped) {
      return { session: { sessionId, state, data }, reply: 'Invalid choice. Reply 1 for English or 2 for Kiswahili.' };
    }
    data.language = mapped;
    const platforms = await getAvailablePlatforms();
    state = STATES.PLATFORM_SELECT;
    data.state = state;
    data.platforms = platforms;
    await saveSession({ sessionId, state, data });
    const welcome = (mapped === 'sw') ? 'Karibu! Sasa tutaendelea kwa Kiswahili.' : 'Welcome! We will continue in English.';
    const reply = welcome + '\n\n' + formatPlatformsMessage(platforms, mapped);
    return { session: { sessionId, state, data }, reply };
  }

  // if text looks like an interactive rowId like 'platform:Instagram' or 'svc:12345', normalize it
  let interactive = null;
  if (text && text.includes(':')) {
    const [t, rest] = text.split(':');
    interactive = { type: t, id: decodeURIComponent(rest || '') };
  }

  // User referral & wallet commands
  try {
    const User = require('../models/user');

    // 'referral <phone>' or 'ref <phone>' - register referred_by for the user
    if (lower.startsWith('referral') || lower.startsWith('ref ')) {
      const parts = text.split(/\s+/);
      const refPhone = parts[1] || null;
      if (!refPhone) return { session: { sessionId, state, data }, reply: 'Usage: referral <phone>. Example: referral 2557XXXXXXXX' };
      const clean = refPhone.replace(/[^0-9]/g, '');
      if (!clean) return { session: { sessionId, state, data }, reply: 'Invalid phone number for referral.' };
      let u = await User.findOne({ phone: sessionId }).catch(()=>null);
      if (!u) {
        // create user with referred_by
        const nu = new User({ phone: sessionId, referred_by: clean });
        await nu.save().catch(()=>{});
        return { session: { sessionId, state, data }, reply: `Referral recorded. You were referred by ${clean}.` };
      }
      if (u.referred_by) return { session: { sessionId, state, data }, reply: `You already have a referrer recorded: ${u.referred_by}` };
      u.referred_by = clean;
      await u.save().catch(()=>{});
      return { session: { sessionId, state, data }, reply: `Referral recorded. You were referred by ${clean}.` };
    }

    // generate or show user's referral code and wa.me link
    if (lower === 'my code' || lower === 'referral code' || lower === 'my referral code' || lower === 'code') {
      let u = await User.findOne({ phone: sessionId }).catch(()=>null);
      if (!u) {
        u = new User({ phone: sessionId });
        await u.save().catch(()=>{});
      }
      if (!u.referralCode) {
        const makeCode = () => (String(sessionId).slice(-6) + Math.random().toString(36).slice(2,6)).toUpperCase();
        let code = makeCode();
        let exists = await User.findOne({ referralCode: code }).catch(()=>null);
        let attempts = 0;
        while (exists && attempts < 8) { code = makeCode(); exists = await User.findOne({ referralCode: code }).catch(()=>null); attempts++; }
        u.referralCode = code;
        await u.save().catch(()=>{});
      }
      const botNumber = process.env.WA_PHONE_NUMBER || '';
      const link = `https://wa.me/${botNumber}?text=${encodeURIComponent('REF:'+u.referralCode)}`;
      const reply = `Your referral code: *${u.referralCode}*\nShare this link with friends:\n${link}\nYou earn TZS 100 when they complete their first successful order. Withdraw at TZS 5000.`;
      return { session: { sessionId, state, data }, reply };
    }

    // list referrals for this user
    if (lower === 'referrals' || lower === 'my referrals') {
      const u = await User.findOne({ phone: sessionId }).lean().catch(()=>null);
      if (!u) return { session: { sessionId, state, data }, reply: 'No referrals yet. Generate your referral code with "my code".' };
      const referees = await User.find({ referred_by: sessionId }).sort({ createdAt: -1 }).limit(100).lean().catch(()=>[]);
      const lines = [];
      lines.push(`Your referrals: ${referees.length} (total earned: TZS ${u.balance_tzs || 0})`);
      if (referees.length) {
        lines.push('Recent referrals:');
        referees.forEach((r,i) => {
          lines.push(`${i+1}. ${r.phone} - joined ${new Date(r.createdAt).toLocaleDateString()}`);
        });
      } else {
        lines.push('No referred users yet. Share your referral link with friends!');
      }
      return { session: { sessionId, state, data }, reply: lines.join('\n') };
    }

    // balance query
    if (lower === 'balance' || lower === '.balance') {
      const u = await User.findOne({ phone: sessionId }).lean().catch(()=>null);
      const bal = u ? (u.balance_tzs || 0) : 0;
      return { session: { sessionId, state, data }, reply: `Your referral balance: TZS ${Number(bal.toFixed ? bal.toFixed(2) : bal)}. You can withdraw when balance >= TZS 5000.` };
    }

    // withdraw command: 'withdraw <amount>' or '.withdraw <amount>'
    if (lower.startsWith('withdraw') || lower.startsWith('.withdraw')) {
      const parts = text.split(/\s+/);
      const amt = Number(parts[1] || 0);
      if (!Number.isFinite(amt) || amt <= 0) return { session: { sessionId, state, data }, reply: 'Usage: withdraw <amount>. Amount must be a positive number.' };
      const u = await User.findOne({ phone: sessionId }).catch(()=>null);
      if (!u) return { session: { sessionId, state, data }, reply: 'No balance found for your account.' };
      if ((u.balance_tzs || 0) < 5000) return { session: { sessionId, state, data }, reply: 'Minimum balance for withdrawal is TZS 5000.' };
      if (amt > (u.balance_tzs || 0)) return { session: { sessionId, state, data }, reply: 'Insufficient balance for that withdrawal amount.' };
      u.balance_tzs = Number((u.balance_tzs || 0) - amt);
      u.withdrawn = Number((u.withdrawn || 0) + amt);
      await u.save().catch(()=>{});
      return { session: { sessionId, state, data }, reply: `Withdrawal requested for TZS ${amt}. Remaining balance: TZS ${u.balance_tzs}. Our admin will process the payout.` };
    }
  } catch (e) {
    // non-fatal; continue with normal flow
    console.error('referral command error', e && e.message);
  }

  // Global quick commands
  if (lower === 'back' || lower === 'cancel' || lower === 'menu') {
    const platforms = await getAvailablePlatforms();
    const reply = formatPlatformsMessage(platforms, (data && data.language) ? data.language : 'en');
    state = STATES.PLATFORM_SELECT;
    data = { state, platforms, language: (data && data.language) ? data.language : 'en' };
    await saveSession({ sessionId, state, data });
    return { session: { sessionId, state, data }, reply };
  }

  // Allow existing users to change language at any time
  if (lower === 'language' || lower === 'lang' || lower === 'change language' || lower === 'chagua lugha' || lower === 'lugha') {
    // prompt language selection in user's current language (or English if unknown)
    const curr = (data && data.language) ? data.language : 'en';
    state = STATES.LANGUAGE_SELECT;
    data = Object.assign({}, data, { state, language: curr });
    await saveSession({ sessionId, state, data });
    const lines = [];
    lines.push('╔' + '═'.repeat(46) + '╗');
    lines.push('║' + ` ${t('choose_language_header', curr)}`.padEnd(44) + '║');
    lines.push('╚' + '═'.repeat(46) + '╝');
    lines.push('');
    lines.push(t('choose_language_prompt', curr));
    lines.push('1. English');
    lines.push('2. Kiswahili');
    return { session: { sessionId, state, data }, reply: lines.join('\n') };
  }

  // Direct language set with 'language en' or 'lang sw'
  if (lower.startsWith('language ') || lower.startsWith('lang ')) {
    const parts = lower.split(/\s+/);
    const want = parts[1];
    const mapped = (want === '1' || want === 'en' || want === 'english') ? 'en' : ((want === '2' || want === 'sw' || want === 'swahili' || want === 'kiswahili') ? 'sw' : null);
    if (!mapped) {
      return { session: { sessionId, state, data }, reply: 'Invalid language. Use "language en" or "language sw".' };
    }
    data = Object.assign({}, data, { language: mapped });
    await saveSession({ sessionId, state, data });
    // also attempt to persist to User record if present
    try { const User = require('../models/user'); await User.updateOne({ phone: sessionId }, { $set: { language: mapped } }).catch(()=>{}); } catch(e) {}
    const reply = (mapped === 'sw') ? 'Lugha imebadilishwa kuwa Kiswahili.' : 'Language changed to English.';
    return { session: { sessionId, state, data }, reply };
  }

  // if text does not match any command, show help
  if (lower === '.help' || lower === 'help') {
    return { session: { sessionId, state, data }, reply: helpText() };
  }

  switch (state) {
    case STATES.START: {
      const platforms = await getAvailablePlatforms();
      // send plain text platforms list (preferred)
      const reply = formatPlatformsMessage(platforms);
      state = STATES.PLATFORM_SELECT;
      data = { state, platforms };
      await saveSession({ sessionId, state, data });
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.PLATFORM_SELECT: {
      // handle interactive selection
      if (interactive && interactive.type === 'platform') {
        const chosen = interactive.id;
        const categories = await getCategoriesForPlatform(chosen);
        state = STATES.CATEGORY_SELECT;
        data = { state, platform: chosen, categories };
        await saveSession({ sessionId, state, data });
        // send categories as plain text
        const lines = ['Choose a category:'];
        categories.forEach((c,i) => lines.push(`${i+1}. ${c}`));
        lines.push('\nReply with the category number.');
        return { session: { sessionId, state, data }, reply: lines.join('\n') };
      }

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
        // if no categories, jump to services list (plain text pagination)
        const services = await getServicesFor(chosen, null);
        data.servicesList = services;
        data.state = STATES.SERVICE_SELECT;
        state = STATES.SERVICE_SELECT;
        await saveSession({ sessionId, state, data });
        const reply = buildPlainServicePage(services, chosen, '', 1);
        return { session: { sessionId, state, data }, reply };
      }
      const lines = ['Choose a category:'];
      categories.forEach((c,i) => lines.push(`${i+1}. ${c}`));
      lines.push('\nReply with the category number.');
      return { session: { sessionId, state, data }, reply: lines.join('\n') };
    }

    case STATES.CATEGORY_SELECT: {
      // interactive selection
      if (interactive && interactive.type === 'category') {
        const chosenCat = interactive.id;
        const platform = data.platform;
        const services = await getServicesFor(platform, chosenCat);
        if (!services.length) return { session: { sessionId, state, data }, reply: 'No services found for that category.' };
        data = { state: STATES.SERVICE_SELECT, platform, category: chosenCat, servicesList: services };
        state = STATES.SERVICE_SELECT;
        await saveSession({ sessionId, state, data });
        const reply = buildPlainServicePage(services, platform, chosenCat, 1);
        return { session: { sessionId, state, data }, reply };
      }

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
      const reply = buildPlainServicePage(services, platform, chosenCat, 1);
      return { session: { sessionId, state, data }, reply };
    }

    case STATES.SERVICE_select: // accidental old constant fallback
    case STATES.SERVICE_SELECT: {
      // interactive selection
      if (interactive && interactive.type === 'svc') {
        const svcId = interactive.id;
        let svc = data.servicesList && data.servicesList.find(s => String(s.id) === String(svcId));
        if (!svc) {
          // try fetching by id
          svc = await smm.getServiceById(svcId).catch(()=>null) || await SmmService.findOne({ serviceId: svcId }).lean().catch(()=>null) || null;
          if (!svc) return { session: { sessionId, state, data }, reply: 'Selected service not found.' };
        }
        data.selectedService = svc;
        data.state = STATES.ENTER_LINK;
        state = STATES.ENTER_LINK;
        await saveSession({ sessionId, state, data });
        const reply = `You selected *${svc.name}*${svc.price?(' - '+svc.price):''}.\nPlease send the target link or username (e.g. https://instagram.com/username).`;
        return { session: { sessionId, state, data }, reply };
      }

      // handle service page navigation token
      if (interactive && interactive.type === 'svc_page') {
        const token = parseServicePageToken(interactive.id);
        if (token) {
          const platform = token.platform || data.platform;
          const category = token.category || data.category || '';
          const page = token.page || 1;
          const services = data.servicesList || await getServicesFor(platform, category);
          // send requested page as plain text
          const reply = buildPlainServicePage(services, platform, category, page);
          return { session: { sessionId, state, data }, reply };
        }
      }

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
