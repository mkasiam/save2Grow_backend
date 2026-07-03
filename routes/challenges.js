const express = require('express');
const Challenge = require('../models/Challenge');
const UserChallenge = require('../models/UserChallenge');
const { authorize, isAdmin } = require('../middleware/auth');

const router = express.Router();

const buildChallengeResponse = async (challenges) => {
  const challengeIds = challenges.map((challenge) => challenge._id);
  const userChallenges = await UserChallenge.find({ challengeId: { $in: challengeIds } })
    .populate('userId', 'name email');

  const challengeMap = {};
  userChallenges.forEach((uc) => {
    const challengeKey = String(uc.challengeId);
    if (!challengeMap[challengeKey]) {
      challengeMap[challengeKey] = [];
    }
    if (uc.userId) {
      challengeMap[challengeKey].push(uc.userId);
    }
  });

  return challenges.map((challenge) => {
    const participants = challengeMap[String(challenge._id)] || [];
    return {
      ...challenge.toObject(),
      participantIds: participants,
    };
  });
};

// Create a new challenge (Admin only).
router.post('/', authorize, isAdmin, async (req, res) => {
  try {
    const { title, description, type, targetValue, reward, endDate, startDate, status } = req.body;

    const challenge = new Challenge({
      title,
      description,
      type,
      targetValue,
      reward,
      startDate,
      endDate,
      status,
    });

    await challenge.save();
    res.status(201).json(challenge);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin', authorize, isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
    } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [total, challenges] = await Promise.all([
      Challenge.countDocuments(filter),
      Challenge.find(filter)
        .sort('-createdAt')
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize),
    ]);

    const response = await buildChallengeResponse(challenges);

    res.json({
      data: response,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/admin/:id', authorize, isAdmin, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const fields = ['title', 'description', 'type', 'targetValue', 'reward', 'startDate', 'endDate', 'status'];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        challenge[field] = req.body[field];
      }
    });

    await challenge.save();
    res.json(challenge);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/admin/:id', authorize, isAdmin, async (req, res) => {
  try {
    const challenge = await Challenge.findByIdAndDelete(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    await UserChallenge.deleteMany({ challengeId: req.params.id });
    res.json({ message: 'Challenge deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return all active challenges so the client can render the discovery feed.
router.get('/', async (req, res) => {
  try {
    const challenges = await Challenge.find({ status: 'active' }).sort('-createdAt');

    const response = await buildChallengeResponse(challenges);

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
