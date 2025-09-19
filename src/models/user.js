const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  balance_tzs: { type: Number, default: 0 },
  referred_by: { type: String, default: null },
  referrals: { type: Number, default: 0 },
  withdrawn: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true },
  language: { type: String, enum: ['en','sw'], default: 'en' }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
