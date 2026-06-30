const mongoose = require('mongoose');

const studentProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  university: {
    type: String,
    required: [true, 'Please provide your university'],
    trim: true,
  },
  studentId: {
    type: String,
    required: [true, 'Please provide your student ID'],
    trim: true,
  },
  totalSavings: {
    type: Number,
    default: 0,
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending',
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

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
