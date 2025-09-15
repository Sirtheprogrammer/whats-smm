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

    // update based on payment_status
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
        const newStatus = (createResp && (createResp.result || createResp.status || (createResp.error ? 'FAILED' : 'SUBMITTED'))) || 'SUBMITTED';
        order.providerResponse = createResp;
        order.status = newStatus === 'SUCCESS' || newStatus === 'COMPLETED' || newStatus === 'SUBMITTED' ? 'PROCESSING' : (createResp && createResp.error ? 'FAILED' : newStatus);
        order.remoteOrderId = createResp && (createResp.order || createResp.id || createResp.reference || createResp.transid) || null;
        await order.save();
        logCollector.add(`Order ${order_id} submitted to SMM provider. status=${order.status}`);

        // update session if present
        try {
          const Session = require('../models/session');
          await Session.updateOne({ sessionId: order.sessionId }, { $set: { 'data.order.remote': createResp, 'data.order.status': order.status, 'data.order.remoteOrderId': order.remoteOrderId } }).catch(()=>{});
        } catch (e) {}

        // notify user via WhatsApp
        try {
          const to = order.sessionId || order.paymentPhone || order.buyer_phone;
          if (to) {
            const msg = createResp && createResp.error ? `Payment received for order ${order.orderId}, but provider rejected the order: ${createResp.error}. Please contact admin.` : `Payment received and order ${order.orderId} submitted to provider. Remote id: ${order.remoteOrderId || 'n/a'}. We will notify you on updates.`;
            await whatsappBot.sendMessage(to, msg);
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

    // other statuses
    order.paymentMeta = payload;
    await order.save();
    res.json({ success: true });
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
