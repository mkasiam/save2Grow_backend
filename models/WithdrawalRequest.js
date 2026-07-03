const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    default: null,
  },
  userChallengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserChallenge',
    default: null,
  },
  requestType: {
    type: String,
    enum: ['completed_payout', 'early_withdrawal'],
    required: true,
  },
  initialDepositAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  penaltyRate: {
    type: Number,
    default: 0,
  },
  penaltyFee: {
    type: Number,
    default: 0,
  },
  payoutAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  adminNote: {
    type: String,
    trim: true,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
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

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);