const express = require('express');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const UserChallenge = require('../models/UserChallenge');
const StudentProfile = require('../models/StudentProfile');
const { authorize, isAdmin } = require('../middleware/auth');

const router = express.Router();
const VALID_PAYMENT_METHODS = ['bkash', 'nagad', 'bank_transfer', 'card'];

const normalizePaymentMethod = (paymentMethod) => {
  const paymentMap = {
    bkash: 'bkash',
    nagad: 'nagad',
    bank_transfer: 'bank_transfer',
    card: 'card',
  };

  return paymentMap[paymentMethod] || 'bank_transfer';
};

// Create a new transaction and apply its financial impact immediately only if status is completed (e.g. legacy/direct paths)
router.post('/', authorize, async (req, res) => {
  try {
    const { goalId, userChallengeId, type, amount, description, paymentMethod, note, status: reqStatus } = req.body;
    const normalizedDescription =
      typeof description === 'string' ? description.trim() : '';
    const normalizedNote = typeof note === 'string' ? note.trim() : '';

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please provide a valid amount' });
    }

    if (!['deposit', 'withdrawal'].includes(type)) {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    if (!goalId && !userChallengeId) {
      return res.status(400).json({ error: 'Please provide a valid goal id or user challenge id' });
    }

    if (description !== undefined && !normalizedDescription) {
      return res.status(400).json({ error: 'Description cannot be empty' });
    }

    if (normalizedDescription.length > 160) {
      return res.status(400).json({ error: 'Description is too long' });
    }

    if (normalizedNote.length > 300) {
      return res.status(400).json({ error: 'Note is too long' });
    }

    if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    // Verify Goal if goalId is provided
    let goal = null;
    if (goalId) {
      goal = await Goal.findOne({ _id: goalId, userId: req.user.id });
      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }
    }

    // Verify UserChallenge if userChallengeId is provided
    let userChallenge = null;
    if (userChallengeId) {
      userChallenge = await UserChallenge.findOne({ _id: userChallengeId, userId: req.user.id }).populate('challengeId');
      if (!userChallenge) {
        return res.status(404).json({ error: 'User challenge not found' });
      }
    }

    // Set transaction status (default to pending so admins approve physical deposits/withdrawals)
    const transactionStatus = reqStatus || 'pending';

    if (!['pending', 'processing', 'completed', 'failed'].includes(transactionStatus)) {
      return res.status(400).json({ error: 'Invalid transaction status' });
    }

    if (transactionStatus === 'completed' && type === 'withdrawal') {
      if (goal && goal.currentAmount < amount) {
        return res.status(400).json({ error: 'Insufficient goal balance' });
      }
      if (userChallenge && userChallenge.currentProgress < amount) {
        return res.status(400).json({ error: 'Insufficient challenge progress balance' });
      }
    }

    const transaction = new Transaction({
      userId: req.user.id,
      goalId: goalId || null,
      userChallengeId: userChallengeId || null,
      type,
      amount,
      description: normalizedDescription,
      paymentMethod: normalizePaymentMethod(paymentMethod),
      note: normalizedNote,
      status: transactionStatus,
    });

    await transaction.save();

    // Only apply financial impact to Goal, UserChallenge and StudentProfile immediately if status is 'completed'
    if (transactionStatus === 'completed') {
      // Update Goal if target is Goal
      if (goal) {
        if (type === 'deposit') {
          goal.currentAmount += amount;
          if (goal.currentAmount >= goal.targetAmount) {
            goal.status = 'completed';
          }
        } else if (type === 'withdrawal') {
          goal.currentAmount -= amount;
          if (goal.currentAmount < goal.targetAmount) {
            goal.status = 'active';
          }
        }
        await goal.save();
      }

      // Update UserChallenge if target is Challenge
      if (userChallenge) {
        if (type === 'deposit') {
          userChallenge.currentProgress += amount;
          if (userChallenge.currentProgress >= userChallenge.challengeId.targetValue) {
            userChallenge.status = 'completed';
            userChallenge.completedAt = Date.now();
          }
        } else if (type === 'withdrawal') {
          userChallenge.currentProgress = Math.max(0, userChallenge.currentProgress - amount);
          if (userChallenge.currentProgress < userChallenge.challengeId.targetValue) {
            userChallenge.status = 'joined';
            userChallenge.completedAt = null;
          }
        }
        await userChallenge.save();
      }

      // Update StudentProfile aggregate savings
      const studentProfile = await StudentProfile.findOne({ userId: req.user.id });
      if (studentProfile) {
        if (type === 'deposit') {
          studentProfile.totalSavings += amount;
        } else if (type === 'withdrawal') {
          studentProfile.totalWithdrawn += amount;
          studentProfile.totalSavings = Math.max(0, studentProfile.totalSavings - amount);
        }
        studentProfile.updatedAt = Date.now();
        await studentProfile.save();
      }
    }

    res.status(201).json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only route: approve/complete or fail/reject a pending transaction
router.put('/:id/status', authorize, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['completed', 'failed', 'processing'].includes(status)) {
      return res.status(400).json({ error: 'Invalid transaction status' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (!['pending', 'processing'].includes(transaction.status) && transaction.status !== status) {
      return res.status(400).json({ error: 'Transaction is already processed' });
    }

    transaction.status = status;
    transaction.updatedAt = Date.now();
    await transaction.save();

    // If approved, apply financial impact to Goal/UserChallenge and StudentProfile!
    if (status === 'completed') {
      const amount = transaction.amount;

      // Update Goal if transaction has goalId
      if (transaction.goalId) {
        const goal = await Goal.findOne({ _id: transaction.goalId, userId: transaction.userId });
        if (goal) {
          if (transaction.type === 'deposit') {
            goal.currentAmount += amount;
            if (goal.currentAmount >= goal.targetAmount) {
              goal.status = 'completed';
            }
          } else if (transaction.type === 'withdrawal') {
            goal.currentAmount -= amount;
            if (goal.currentAmount < goal.targetAmount) {
              goal.status = 'active';
            }
          }
          await goal.save();
        }
      }

      // Update UserChallenge if transaction has userChallengeId
      if (transaction.userChallengeId) {
        const userChallenge = await UserChallenge.findOne({ _id: transaction.userChallengeId, userId: transaction.userId }).populate('challengeId');
        if (userChallenge) {
          if (transaction.type === 'deposit') {
            userChallenge.currentProgress += amount;
            if (userChallenge.currentProgress >= userChallenge.challengeId.targetValue) {
              userChallenge.status = 'completed';
              userChallenge.completedAt = Date.now();
            }
          } else if (transaction.type === 'withdrawal') {
            userChallenge.currentProgress = Math.max(0, userChallenge.currentProgress - amount);
            if (userChallenge.currentProgress < userChallenge.challengeId.targetValue) {
              userChallenge.status = 'joined';
              userChallenge.completedAt = null;
            }
          }
          await userChallenge.save();
        }
      }

      // Update StudentProfile
      const studentProfile = await StudentProfile.findOne({ userId: transaction.userId });
      if (studentProfile) {
        if (transaction.type === 'deposit') {
          studentProfile.totalSavings += amount;
        } else if (transaction.type === 'withdrawal') {
          studentProfile.totalWithdrawn += amount;
          studentProfile.totalSavings = Math.max(0, studentProfile.totalSavings - amount);
        }
        studentProfile.updatedAt = Date.now();
        await studentProfile.save();
      }
    }

    res.json({ message: `Transaction status updated to ${status}`, transaction });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only route: query all transactions across the entire system.
router.get('/all', authorize, isAdmin, async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('userId', 'name email role')
      .populate('goalId')
      .populate({
        path: 'userChallengeId',
        populate: { path: 'challengeId' }
      })
      .sort('-createdAt');
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return the authenticated user's full transaction history, newest first.
router.get('/', authorize, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id })
      .populate('goalId')
      .populate({
        path: 'userChallengeId',
        populate: { path: 'challengeId' }
      })
      .sort('-createdAt');
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return only the transactions that belong to a specific goal for the current user.
router.get('/goal/:goalId', authorize, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      goalId: req.params.goalId,
      userId: req.user.id,
    }).sort('-createdAt');
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
