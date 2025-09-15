const mongoose = require('mongoose');

const smmServiceSchema = new mongoose.Schema({
  serviceId: { type: String, required: true, index: true },
  platform: { type: String, required: true },
  category: { type: String },
  name: { type: String, required: true },
  price: { type: Number }, // stored in TZS
  raw: { type: Object },
  importedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  minimumQuantity: { type: Number, default: 1 }
});

// update updatedAt on save
smmServiceSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

// virtual for price in TZS (alias)
smmServiceSchema.virtual('price_tzs').get(function() { return this.price; }).set(function(v) { this.price = v; });

module.exports = mongoose.model('SmmService', smmServiceSchema);
