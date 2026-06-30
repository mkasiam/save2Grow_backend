const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a challenge title'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    enum: ['save_amount', 'save_days', 'save_percentage', 'group_challenge'],
    required: true,
  },
  targetValue: {
    type: Number,
    required: true,
  },
  reward: {
    type: String,
    default: 'Badge & Recognition',
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Challenge', challengeSchema);
