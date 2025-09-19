const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const orderSchema = new Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String },
  serviceId: { type: String },
  serviceName: { type: String },
  platform: { type: String },
  category: { type: String },
  target: { type: String },
  quantity: { type: Number },
  pricePerUnit: { type: Number },
  rawPrice: { type: Number },
  priceUnitMultiplier: { type: Number, default: 1 },
  amount_due_tzs: { type: Number },
  paymentPhone: { type: String },
  buyer_phone: { type: String },
  status: { type: String, enum: ['PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED','PROCESSING_PAYMENT','PAYMENT_FAILED'], default: 'PENDING' },
  providerResponse: Schema.Types.Mixed,
  remoteOrderId: { type: String },
  providerPaymentRef: { type: String },
  completedAt: { type: Date },
  referredCredited: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
