const Order = require('../models/order');
const smm = require('./smmguo');
const whatsappBot = require('../bot/whatsapp');
const logCollector = require('../utils/logCollector');

const DEFAULT_INTERVAL_MS = Number(process.env.ORDER_MONITOR_INTERVAL_MS) || 30_000; // 30s default

function parseProviderStatus(resp) {
  // Try common shapes to determine a normalized status: COMPLETED | PROCESSING | FAILED | UNKNOWN
  if (!resp) return { status: 'UNKNOWN', raw: resp };

  // If response has 'status' field
  if (typeof resp.status === 'string') {
    const s = resp.status.toUpperCase();
    if (s.includes('COMPLETE') || s.includes('SUCCESS')) return { status: 'COMPLETED', raw: resp };
    if (s.includes('PROCESS') || s.includes('PENDING')) return { status: 'PROCESSING', raw: resp };
    if (s.includes('FAIL') || s.includes('ERROR') || s.includes('CANCEL')) return { status: 'FAILED', raw: resp };
  }

  // Some providers return result/resultcode
  if (resp.result && typeof resp.result === 'string') {
    const s = resp.result.toUpperCase();
    if (s.includes('SUCCESS') || s.includes('COMPLETED')) return { status: 'COMPLETED', raw: resp };
    if (s.includes('PENDING')) return { status: 'PROCESSING', raw: resp };
    if (s.includes('FAILED') || s.includes('ERROR')) return { status: 'FAILED', raw: resp };
  }

  if (resp.resultcode && String(resp.resultcode) === '000') {
    // some apis use 000 for success
    return { status: 'COMPLETED', raw: resp };
  }

  // data array cases
  if (Array.isArray(resp.data) && resp.data.length) {
    const item = resp.data[0];
    const keys = ['status','order_status','payment_status'];
    for (const k of keys) {
      if (item[k] && typeof item[k] === 'string') {
        const s = String(item[k]).toUpperCase();
        if (s.includes('COMPLETE') || s.includes('SUCCESS')) return { status: 'COMPLETED', raw: resp };
        if (s.includes('PENDING') || s.includes('PROCESS')) return { status: 'PROCESSING', raw: resp };
        if (s.includes('FAIL') || s.includes('ERROR') || s.includes('CANCEL')) return { status: 'FAILED', raw: resp };
      }
    }
  }

  // if response is object with first element
  if (Array.isArray(resp) && resp.length) {
    return parseProviderStatus(resp[0]);
  }

  return { status: 'UNKNOWN', raw: resp };
}

async function checkPendingOrders(batchSize = 20) {
  try {
    // Find orders that have been submitted to provider but not completed/failed
    const q = { remoteOrderId: { $exists: true, $ne: null }, status: { $in: ['PROCESSING','PENDING'] } };
    const orders = await Order.find(q).limit(batchSize).lean();
    if (!orders || !orders.length) return { checked: 0 };

    for (const o of orders) {
      try {
        const providerId = o.remoteOrderId || o.providerResponse && (o.providerResponse.order || o.providerResponse.id || o.providerResponse.reference || o.providerResponse.transid);
        if (!providerId) continue;
        const resp = await smm.getOrderStatus(providerId);
        const parsed = parseProviderStatus(resp);

        // save provider response
        await Order.updateOne({ orderId: o.orderId }, { $set: { providerResponse: resp } }).catch(()=>{});

        if (parsed.status === 'COMPLETED') {
          await Order.updateOne({ orderId: o.orderId }, { $set: { status: 'COMPLETED' } }).catch(()=>{});
          logCollector.add(`Order ${o.orderId} marked COMPLETED by monitor`);
          // notify user
          try {
            const to = o.sessionId || o.paymentPhone || null;
            if (to) {
              const msg = `✅ Your order ${o.orderId} has been completed. Remote id: ${providerId || 'n/a'}.`;
              await whatsappBot.sendMessage(to, msg);
            }
          } catch (e) { logCollector.add('failed to notify user for completed order: ' + (e && e.message)); }
        } else if (parsed.status === 'FAILED') {
          await Order.updateOne({ orderId: o.orderId }, { $set: { status: 'FAILED' } }).catch(()=>{});
          logCollector.add(`Order ${o.orderId} marked FAILED by monitor`);
          try {
            const to = o.sessionId || o.paymentPhone || null;
            if (to) {
              const msg = `⚠️ Your order ${o.orderId} was marked failed by provider. Please contact support or retry.`;
              await whatsappBot.sendMessage(to, msg);
            }
          } catch (e) { logCollector.add('failed to notify user for failed order: ' + (e && e.message)); }
        } else {
          // still processing or unknown; update nothing special
          logCollector.add(`Order ${o.orderId} status checked: ${parsed.status}`);
        }

      } catch (e) {
        logCollector.add('order monitor error for order ' + o.orderId + ': ' + (e && e.message));
      }
    }

    return { checked: orders.length };
  } catch (e) {
    logCollector.add('order monitor general error: ' + (e && e.message));
    return { checked: 0, error: e && e.message };
  }
}

let _intervalHandle = null;

function startOrderMonitor(intervalMs) {
  const ms = Number(intervalMs || DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  if (_intervalHandle) clearInterval(_intervalHandle);
  // run immediately then set interval
  (async () => { try { await checkPendingOrders(); } catch (e) {} })();
  _intervalHandle = setInterval(() => { checkPendingOrders().catch(()=>{}); }, ms);
  logCollector.add('Order monitor started: interval=' + ms + 'ms');
  return { started: true, intervalMs: ms };
}

function stopOrderMonitor() { if (_intervalHandle) clearInterval(_intervalHandle); _intervalHandle = null; }

module.exports = { startOrderMonitor, stopOrderMonitor, checkPendingOrders };
