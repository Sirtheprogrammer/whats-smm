const mongoose = require('mongoose');

const smmServiceSchema = new mongoose.Schema({
  serviceId: { type: String, required: true, index: true },
  platform: { type: String, required: true },
  category: { type: String },
  name: { type: String, required: true },
  price: { type: Number },
  raw: { type: Object },
  importedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SmmService', smmServiceSchema);
