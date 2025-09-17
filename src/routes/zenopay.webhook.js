const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const logCollector = require('../utils/logCollector');
const smm = require('../services/smmguo');
const whatsappBot = require('../bot/whatsapp');

// webhook endpoint for ZenoPay to POST payment updates
router.post('/zenopay', async (req, res) => {
  try {
    const payload = req.body || {};
    const apiKey = req.headers['x-api-key'] || req.headers['x-api-key'.toLowerCase()];
    // basic verification: match API key if provided
    if (process.env.ZENOPAY_API_KEY && apiKey && apiKey !== process.env.ZENOPAY_API_KEY) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { order_id, payment_status, reference, metadata } = payload;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    // find order by orderId
    const order = await Order.findOne({ orderId: order_id }).catch(()=>null);
    if (!order) return res.status(404).json({ error: 'order not found' });

    // detect explicit failed/declined statuses and handle them
    const ps = (payment_status || payload.status || '').toString().toUpperCase();
    const failedSet = new Set(['FAILED','DECLINED','CANCELLED','ERROR','INSUFFICIENT_FUNDS','REJECTED']);
    if (ps && failedSet.has(ps)) {
      order.status = 'PAYMENT_FAILED';
      order.paymentMeta = payload;
      order.providerPaymentRef = reference || payload.reference || null;
      await order.save().catch(()=>{});
      logCollector.add(`Payment failed for order ${order_id}, status=${ps}`);

      // notify user via WhatsApp about failed payment and retry instructions
      try {
        const to = order.sessionId || order.paymentPhone || order.buyer_phone;
        if (to) {
          const msg = `Payment for order ${order.orderId} was unsuccessful (${ps}). If you'd like to try again, reply with *retry ${order.orderId}* or just *retry* in this chat to re-attempt payment.`;
          await whatsappBot.sendMessage(to, msg);
        }
      } catch (e) {
        logCollector.add('failed to notify user about failed payment: ' + (e && e.message));
      }

      return res.json({ success: true });
    }

    // handle completed payments (existing flow)
    if (payment_status === 'COMPLETED' || payload.payment_status === 'COMPLETED') {
      order.status = 'PROCESSING';
      order.providerPaymentRef = reference || (payload.reference || null);
      order.paymentMeta = metadata || payload.metadata || null;
      await order.save();
      logCollector.add('Payment completed for order ' + order_id);

      // now automatically submit to SMM provider
      try {
        // build create payload
        const serviceId = order.serviceId || order.service || (order.service && (order.service.id || order.service.serviceId));
        const link = order.target || order.link || '';
        const quantity = order.quantity || order.qty || 1;
        const buyer_phone = order.paymentPhone || order.buyer_phone || '';

        const createResp = await smm.createOrder({ service: serviceId, link, quantity, buyer_phone });

        // update order with provider response and status
        // normalize provider response to determine if order is already completed
        function normalizeProviderStatus(resp) {
          if (!resp) return 'UNKNOWN';
          if (typeof resp.status === 'string') {
            const s = resp.status.toUpperCase();
            if (s.includes('COMPLETE') || s.includes('SUCCESS')) return 'COMPLETED';
            if (s.includes('PROCESS') || s.includes('PENDING')) return 'PROCESSING';
            if (s.includes('FAIL') || s.includes('ERROR') || s.includes('CANCEL')) return 'FAILED';
          }
          if (resp.result && typeof resp.result === 'string') {
            const s = resp.result.toUpperCase();
            if (s.includes('SUCCESS') || s.includes('COMPLETED')) return 'COMPLETED';
            if (s.includes('PENDING')) return 'PROCESSING';
            if (s.includes('FAILED') || s.includes('ERROR')) return 'FAILED';
          }
          if (resp.resultcode && String(resp.resultcode) === '000') return 'COMPLETED';
          if (Array.isArray(resp.data) && resp.data.length) {
            const item = resp.data[0];
            for (const k of ['status','order_status','payment_status']) {
              if (item[k] && typeof item[k] === 'string') {
                const s = String(item[k]).toUpperCase();
                if (s.includes('COMPLETE') || s.includes('SUCCESS')) return 'COMPLETED';
                if (s.includes('PENDING') || s.includes('PROCESS')) return 'PROCESSING';
                if (s.includes('FAIL') || s.includes('ERROR') || s.includes('CANCEL')) return 'FAILED';
              }
            }
          }
          return 'UNKNOWN';
        }

        const parsedStatus = normalizeProviderStatus(createResp);
        order.providerResponse = createResp;
        order.remoteOrderId = createResp && (createResp.order || createResp.id || createResp.reference || createResp.transid) || null;
        if (parsedStatus === 'COMPLETED') {
          order.status = 'COMPLETED';
          order.completedAt = new Date();
        } else if (parsedStatus === 'FAILED') {
          order.status = 'FAILED';
        } else {
          // keep processing/submitted mapping
          const newStatus = (createResp && (createResp.result || createResp.status || (createResp.error ? 'FAILED' : 'SUBMITTED'))) || 'SUBMITTED';
          order.status = newStatus === 'SUCCESS' || newStatus === 'COMPLETED' || newStatus === 'SUBMITTED' ? 'PROCESSING' : (createResp && createResp.error ? 'FAILED' : newStatus);
        }
        await order.save();
        logCollector.add(`Order ${order_id} submitted to SMM provider. status=${order.status}`);

        // credit referral bonus if order completed and not yet credited
        try {
          if (order.status === 'COMPLETED' && !order.referredCredited) {
            const User = require('../models/user');
            // check if the ordering user exists
            const buyerPhone = order.sessionId || order.paymentPhone || order.buyer_phone || null;
            if (buyerPhone) {
              const u = await User.findOne({ phone: buyerPhone }).catch(()=>null) || null;
              if (u && u.referred_by) {
                const ref = await User.findOne({ phone: u.referred_by }).catch(()=>null) || null;
                if (ref) {
                  ref.balance_tzs = Number((ref.balance_tzs || 0) + 100);
                  ref.referrals = (ref.referrals || 0) + 1;
                  await ref.save().catch(()=>{});
                  // mark order as credited
                  order.referredCredited = true;
                  await order.save().catch(()=>{});

                  // notify referrer
                  try {
                    await whatsappBot.sendMessage(ref.phone, `🎉 You earned TZS 100 for referring ${buyerPhone}. Your new balance is TZS ${ref.balance_tzs}. Withdraw when balance reaches TZS 5000.`);
                  } catch (e) { logCollector.add('failed to notify referrer: ' + (e && e.message)); }

                  // notify buyer about referral credit
                  try {
                    await whatsappBot.sendMessage(buyerPhone, `Thanks for using our service! Your referrer ${ref.phone} has been credited TZS 100.`);
                  } catch (e) { logCollector.add('failed to notify buyer about referral credit: ' + (e && e.message)); }
                }
              }
            }
          }
        } catch (e) { logCollector.add('referral credit error: ' + (e && e.message)); }

        // update session if present
        try {
          const Session = require('../models/session');
          await Session.updateOne({ sessionId: order.sessionId }, { $set: { 'data.order.remote': createResp, 'data.order.status': order.status, 'data.order.remoteOrderId': order.remoteOrderId, 'data.order.completedAt': order.completedAt || null } }).catch(()=>{});
        } catch (e) {}

        // notify user via WhatsApp
        try {
          const to = order.sessionId || order.paymentPhone || order.buyer_phone;
          if (to) {
            if (order.status === 'COMPLETED') {
              const when = order.completedAt ? (new Date(order.completedAt)).toLocaleString() : new Date().toLocaleString();
              const msg = `✅ Your order ${order.orderId} has been completed.\nService: ${order.serviceName || order.serviceId || ''}\nQuantity: ${order.quantity || 'N/A'}\nRemote id: ${order.remoteOrderId || 'n/a'}\nCompleted at: ${when}`;
              await whatsappBot.sendMessage(to, msg);
            } else {
              const msg = createResp && createResp.error ? `Payment received for order ${order.orderId}, but provider rejected the order: ${createResp.error}. Please contact admin.` : `Payment received and order ${order.orderId} submitted to provider. Remote id: ${order.remoteOrderId || 'n/a'}. We will notify you on updates.`;
              await whatsappBot.sendMessage(to, msg);
            }
          }
        } catch (e) {
          logCollector.add('failed to notify user about order submission: ' + (e && e.message));
        }

        return res.json({ success: true });
      } catch (e) {
        logCollector.add('auto-submit to provider failed for order ' + order_id + ': ' + (e && e.message));
        // set order to failed submission state
        order.status = 'FAILED';
        order.providerResponse = { error: e && (e.message || String(e)) };
        await order.save().catch(()=>{});

        // try notify user about failure
        try { if (order.sessionId) await whatsappBot.sendMessage(order.sessionId, `Payment received for order ${order.orderId}, but automatic submission failed. Admin will review.`); } catch (e) {}

        return res.status(500).json({ error: 'failed to submit to provider' });
      }
    }

    // other statuses: just persist metadata for now
    order.paymentMeta = payload;
    await order.save();
    res.json({ success: true });
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
