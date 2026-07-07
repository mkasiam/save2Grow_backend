const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: [true, 'Please provide a goal title'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  targetAmount: {
    type: Number,
    required: [true, 'Please provide a target amount'],
    min: 100,
  },
  currentAmount: {
    type: Number,
    default: 0,
    required: false,
  },
  targetDate: {
    type: Date,
    required: [true, 'Please provide a target date'],
  },
  category: {
    type: String,
    enum: ['education', 'travel', 'emergency', 'investment', 'other'],
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active',
  },
  icon: {
    type: String,
    default: '🎯',
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

// Calculate capped progress so UI components never render more than 100%.
goalSchema.methods.getProgress = function() {
  return Math.min((this.currentAmount / this.targetAmount) * 100, 100);
};

// Treat the goal as completed once current savings reach or exceed the target amount.
goalSchema.methods.isCompleted = function() {
  return this.currentAmount >= this.targetAmount;
};

module.exports = mongoose.model('Goal', goalSchema);
