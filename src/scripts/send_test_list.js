#!/usr/bin/env node
require('dotenv').config();

const whatsapp = require('../bot/whatsapp');

const samplePlatforms = [
  'Instagram followers [Old Accounts +15 Posts] Provider ⭐🔥',
  'Telegram Bot Start [Target 🎯]',
  'Tiktok Followers [Best Price]',
  'YouTube Views Arab 🇸🇦 / worldwide 🌍 [100% Ads] - Provider'
];

function safeText(s, max = 120) {
  if (!s) return '';
  const t = String(s).replace(/\r?\n/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + '...';
}

async function waitForConnection(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = whatsapp.getConnectionStatus && whatsapp.getConnectionStatus();
    if (st && st.isConnected) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  try {
    // ensure socket initialized
    try { await whatsapp.init(); } catch (e) { /* ignore init errors if already initialized */ }

    const ok = await waitForConnection(30000);
    if (!ok) {
      console.error('WhatsApp bot not connected; aborting');
      process.exit(1);
    }

    const target = process.argv[2] || process.env.TEST_TARGET || process.env.WA_PHONE_NUMBER;
    if (!target) {
      console.error('No target phone provided. Usage: node src/scripts/send_test_list.js 2557XXXXXXX');
      process.exit(2);
    }

    const to = target.includes('@s.whatsapp.net') ? target : `${target}@s.whatsapp.net`;

    // Build a clean plain-text listing with numbers and short ids so client always sees it
    const title = 'Choose platform';
    const intro = 'Select a platform to start. Reply with the number or the id.';

    let plain = '';
    plain += `*${safeText(title, 100)}*\n`;
    plain += `${safeText(intro, 200)}\n\n`;

    let counter = 1;
    plain += '_Platforms:_\n';
    for (const p of samplePlatforms) {
      const short = safeText(p, 80);
      const rowId = `platform:${encodeURIComponent(p)}`;
      plain += `${counter}. ${short}\n   id: ${rowId}\n\n`;
      counter++;
    }

    plain += '\nIf you want to go back, reply with "back".';

    console.log('Sending plain text list to', to);
    try {
      const resp = await whatsapp.sendMessage(target, plain);
      console.log('Plain list send response:', JSON.stringify(resp, null, 2));
      console.log('Sent plain list successfully. Check the client chat.');
      process.exit(0);
    } catch (sendErr) {
      console.error('Failed to send plain list:', sendErr && (sendErr.message || sendErr));
      process.exit(3);
    }
  } catch (e) {
    console.error('Unexpected error in test script:', e && e.stack || e);
    process.exit(99);
  }
}

main();
