const mongoose = require('mongoose');

const userChallengeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    required: true,
  },
  currentProgress: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['joined', 'completed', 'failed'],
    default: 'joined',
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
    default: null,
  },
});

// A user can only join a challenge once
userChallengeSchema.index({ userId: 1, challengeId: 1 }, { unique: true });

module.exports = mongoose.model('UserChallenge', userChallengeSchema);
