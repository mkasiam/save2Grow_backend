const express = require('express');
const Goal = require('../models/Goal');
const UserChallenge = require('../models/UserChallenge');
const StudentProfile = require('../models/StudentProfile');
const { authorize } = require('../middleware/auth');

const router = express.Router();
const VALID_CATEGORIES = ['education', 'travel', 'emergency', 'investment', 'other'];
const VALID_STATUSES = ['active', 'completed', 'abandoned'];

const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());

// Create a new savings goal for the authenticated user and persist the initial goal metadata.
router.post('/', authorize, async (req, res) => {
  try {
    const { title, description, targetAmount, targetDate, category, icon } = req.body;
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';
    const parsedTargetAmount = Number(targetAmount);

    if (!normalizedTitle) {
      return res.status(400).json({ error: 'Please provide a valid goal title' });
    }

    if (!Number.isFinite(parsedTargetAmount) || parsedTargetAmount < 100) {
      return res.status(400).json({ error: 'Target amount must be at least 100' });
    }

    if (!targetDate || !isValidDate(targetDate)) {
      return res.status(400).json({ error: 'Please provide a valid target date' });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Please provide a valid goal category' });
    }

    const goal = new Goal({
      userId: req.user.id,
      title: normalizedTitle,
      description: normalizedDescription,
      targetAmount: parsedTargetAmount,
      targetDate,
      category,
      icon: icon || '🎯',
    });

    await goal.save();
    res.status(201).json(goal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return every goal that belongs to the currently authenticated user.
router.get('/', authorize, async (req, res) => {
  try {
    const [goals, activeUserChallenges] = await Promise.all([
      Goal.find({ userId: req.user.id }).sort('-createdAt'),
      UserChallenge.find({ userId: req.user.id, status: 'joined' })
        .populate('challengeId')
        .sort('-joinedAt'),
    ]);

    const unifiedGoals = [
      ...goals.map((goal) => ({
        ...goal.toObject(),
        id: goal._id,
        entityType: 'goal',
        sourceType: 'goal',
      })),
      ...activeUserChallenges
        .filter((userChallenge) => userChallenge.challengeId)
        .map((userChallenge) => ({
          ...userChallenge.challengeId.toObject(),
          id: userChallenge.challengeId._id,
          entityType: 'userChallenge',
          sourceType: 'challenge',
          userChallengeId: userChallenge._id,
          currentAmount: userChallenge.currentProgress,
          currentProgress: userChallenge.currentProgress,
          targetAmount: userChallenge.challengeId.targetValue,
          targetValue: userChallenge.challengeId.targetValue,
          targetDate: userChallenge.challengeId.endDate,
          category: 'challenge',
          icon: '🏁',
          status: userChallenge.status === 'completed' ? 'completed' : 'active',
        })),
    ];

    res.json(unifiedGoals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return one goal by id so the app can load its detail view.
router.get('/:id', authorize, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user.id });
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json(goal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update editable goal fields without replacing the full document.
router.put('/:id', authorize, async (req, res) => {
  try {
    const { title, description, targetAmount, targetDate, category, status } = req.body;

    let goal = await Goal.findOne({ _id: req.params.id, userId: req.user.id });
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Please provide a valid goal title' });
      }
      goal.title = title.trim();
    }

    if (description !== undefined) {
      goal.description = typeof description === 'string' ? description.trim() : '';
    }

    if (targetAmount !== undefined) {
      const parsedTargetAmount = Number(targetAmount);
      if (!Number.isFinite(parsedTargetAmount) || parsedTargetAmount < 100) {
        return res.status(400).json({ error: 'Target amount must be at least 100' });
      }
      goal.targetAmount = parsedTargetAmount;
    }

    if (targetDate !== undefined) {
      if (!targetDate || !isValidDate(targetDate)) {
        return res.status(400).json({ error: 'Please provide a valid target date' });
      }
      goal.targetDate = targetDate;
    }

    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Please provide a valid goal category' });
      }
      goal.category = category;
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Please provide a valid goal status' });
      }
      goal.status = status;
    }
    goal.updatedAt = Date.now();

    await goal.save();
    res.json(goal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a goal permanently when the owner removes it from their plan.
router.delete('/:id', authorize, async (req, res) => {
  try {
    const goal = await Goal.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a savings contribution to a goal and keep the user's total savings in sync.
router.post('/:id/add-savings', authorize, async (req, res) => {
  try {
    const { amount } = req.body;

    let goal = await Goal.findOne({ _id: req.params.id, userId: req.user.id });
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please provide a valid amount' });
    }

    goal.currentAmount += amount;
    
    // Mirror the new deposit in the student's profile aggregate savings total.
    const studentProfile = await StudentProfile.findOne({ userId: req.user.id });
    if (studentProfile) {
      studentProfile.totalSavings += amount;
      studentProfile.updatedAt = Date.now();
      await studentProfile.save();
    }

    await goal.save();
    res.json({
      goal,
      progress: goal.getProgress(),
      isCompleted: goal.isCompleted(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
