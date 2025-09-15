/* Create a test Order in MongoDB so we can test ZenoPay webhook end-to-end.

   Usage: node src/scripts/create_test_order.js
*/

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/order');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whats-smm';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  const orderId = 'local-test-001';
  const existing = await Order.findOne({ orderId }).lean();
  if (existing) {
    console.log('Test order already exists:', existing.orderId);
    await mongoose.disconnect();
    return;
  }

  const o = new Order({
    orderId,
    sessionId: '255700000000',
    serviceId: 'sample-1',
    serviceName: 'Sample Service',
    platform: 'Instagram',
    category: 'Followers',
    target: 'https://instagram.com/testuser',
    quantity: 1,
    pricePerUnit: 1000,
    rawPrice: 1000,
    priceUnitMultiplier: 1,
    amount_due_tzs: 1000,
    paymentPhone: '255700000000',
    status: 'PENDING'
  });

  const saved = await o.save();
  console.log('Created test order:', saved.orderId);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
