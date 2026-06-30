const express = require('express');
const Challenge = require('../models/Challenge');
const UserChallenge = require('../models/UserChallenge');
const { authorize, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Create a new challenge (Admin only).
router.post('/', authorize, isAdmin, async (req, res) => {
  try {
    const { title, description, type, targetValue, reward, endDate } = req.body;

    const challenge = new Challenge({
      title,
      description,
      type,
      targetValue,
      reward,
      endDate,
    });

    await challenge.save();
    res.status(201).json(challenge);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return all active challenges so the client can render the discovery feed.
router.get('/', async (req, res) => {
  try {
    const challenges = await Challenge.find({ status: 'active' }).sort('-createdAt');

    // Fetch participants for each challenge to preserve the participantIds field in response
    const challengeIds = challenges.map(c => c._id);
    const userChallenges = await UserChallenge.find({ challengeId: { $in: challengeIds } })
      .populate('userId', 'name email');

    const challengeMap = {};
    userChallenges.forEach(uc => {
      if (!challengeMap[uc.challengeId]) {
        challengeMap[uc.challengeId] = [];
      }
      if (uc.userId) {
        challengeMap[uc.challengeId].push(uc.userId);
      }
    });

    const response = challenges.map(challenge => {
      const participants = challengeMap[challenge._id] || [];
      return {
        ...challenge.toObject(),
        participantIds: participants,
      };
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add the authenticated user to a challenge unless they already joined it.
router.post('/:id/join', authorize, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    let userChallenge = await UserChallenge.findOne({
      userId: req.user.id,
      challengeId: challenge._id,
    });

    if (!userChallenge) {
      userChallenge = new UserChallenge({
        userId: req.user.id,
        challengeId: challenge._id,
        currentProgress: 0,
        status: 'joined',
      });
      await userChallenge.save();
    }

    // Populate and format response for backward compatibility
    const allUcs = await UserChallenge.find({ challengeId: challenge._id })
      .populate('userId', 'name email');
    const participantIds = allUcs.map(uc => uc.userId).filter(Boolean);

    res.json({
      ...challenge.toObject(),
      participantIds,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return only the challenges the current user is already participating in.
router.get('/user/challenges', authorize, async (req, res) => {
  try {
    const userChallenges = await UserChallenge.find({ userId: req.user.id })
      .populate('challengeId')
      .sort('-joinedAt');

    const response = [];
    for (const uc of userChallenges) {
      if (uc.challengeId) {
        // Fetch all participants for this challenge to satisfy React Native components
        const allUcsForChallenge = await UserChallenge.find({ challengeId: uc.challengeId._id })
          .populate('userId', 'name email');
        const participantIds = allUcsForChallenge.map(item => item.userId).filter(Boolean);

        response.push({
          ...uc.challengeId.toObject(),
          participantIds,
          userChallengeStatus: uc.status,
          currentProgress: uc.currentProgress,
          userChallengeId: uc._id,
        });
      }
    }

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
