const mongoose = require('mongoose');

const orderLogSchema = new mongoose.Schema({
  orderId: String,
  action: String, // 'PLACED', 'CANCELLED', 'UPDATED'
  orderDetails: Object,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('OrderLog', orderLogSchema);

