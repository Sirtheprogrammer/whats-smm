// Simple in-memory log collector with fixed size ring buffer
const MAX_ENTRIES = Number(process.env.DASHBOARD_LOGS_MAX || 200);
const logs = [];

function add(entry) {
  const e = { time: new Date().toISOString(), entry };
  logs.push(e);
  if (logs.length > MAX_ENTRIES) logs.shift();
}

function getRecent(limit = 100) {
  return logs.slice(-limit).reverse();
}

module.exports = { add, getRecent };
