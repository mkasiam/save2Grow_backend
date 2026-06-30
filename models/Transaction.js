const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  goalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Goal',
    default: null,
  },
  userChallengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserChallenge',
    default: null,
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal'],
    required: true,
  },
  amount: {
    type: Number,
    required: [true, 'Please provide an amount'],
    min: 1,
  },
  description: {
    type: String,
    trim: true,
  },
  note: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    enum: ['bkash', 'nagad', 'bank_transfer', 'card'],
    default: 'bank_transfer',
  },
  transactionId: {
    type: String,
    unique: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate a human-readable transaction identifier before the document is stored.
transactionSchema.pre('save', function(next) {
  if (!this.transactionId) {
    this.transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);
