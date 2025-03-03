const mongoose = require('mongoose');

const functionHistorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  type: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model('FunctionHistory', functionHistorySchema);

