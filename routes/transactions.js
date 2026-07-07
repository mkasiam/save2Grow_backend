const express = require('express');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const UserChallenge = require('../models/UserChallenge');
const StudentProfile = require('../models/StudentProfile');
const { authorize, isAdmin, requireVerifiedStudent } = require('../middleware/auth');

const router = express.Router();
const VALID_PAYMENT_METHODS = ['bkash', 'nagad', 'bank_transfer', 'card', 'sslcommerz'];

const normalizePaymentMethod = (paymentMethod) => {
  const paymentMap = {
    bkash: 'bkash',
    nagad: 'nagad',
    bank_transfer: 'bank_transfer',
    card: 'card',
    sslcommerz: 'sslcommerz',
  };

  return paymentMap[paymentMethod] || 'bank_transfer';
};

const resolveWithdrawalTarget = async ({ goalId, userChallengeId, userId }) => {
  if (goalId) {
    const goal = await Goal.findOne({ _id: goalId, userId });
    if (!goal) {
      return { error: { status: 404, message: 'Goal not found' } };
    }

    return { kind: 'goal', target: goal, balance: Number(goal.currentAmount || 0) };
  }

  const userChallenge = await UserChallenge.findOne({ _id: userChallengeId, userId }).populate('challengeId');
  if (!userChallenge) {
    return { error: { status: 404, message: 'User challenge not found' } };
  }

  return { kind: 'userChallenge', target: userChallenge, balance: Number(userChallenge.currentAmount || 0) };
};

const applyTransactionImpact = async ({ transaction, goal, userChallenge, userId }) => {
  const targetGoal = goal || (transaction.goalId ? await Goal.findOne({ _id: transaction.goalId, userId }) : null);
  const targetUserChallenge = userChallenge || (
    transaction.userChallengeId
      ? await UserChallenge.findOne({ _id: transaction.userChallengeId, userId }).populate('challengeId')
      : null
  );

  if (targetGoal) {
    if (transaction.type === 'deposit') {
      targetGoal.currentAmount += transaction.amount;
      if (targetGoal.currentAmount >= targetGoal.targetAmount) {
        targetGoal.status = 'completed';
      }
    } else if (transaction.type === 'withdrawal') {
      if (targetGoal.currentAmount < transaction.amount) {
        throw new Error('Requested withdrawal exceeds the available balance');
      }
      targetGoal.currentAmount -= transaction.amount;
      if (targetGoal.currentAmount < targetGoal.targetAmount) {
        targetGoal.status = 'active';
      }
    }
    targetGoal.updatedAt = Date.now();
    await targetGoal.save();
  }

  if (targetUserChallenge) {
    if (transaction.type === 'deposit') {
      targetUserChallenge.currentAmount += transaction.amount;
      if (targetUserChallenge.currentAmount >= targetUserChallenge.targetValue) {
        targetUserChallenge.status = 'completed';
        targetUserChallenge.completedAt = Date.now();
      }
    } else if (transaction.type === 'withdrawal') {
      if (targetUserChallenge.currentAmount < transaction.amount) {
        throw new Error('Requested withdrawal exceeds the available balance');
      }
      targetUserChallenge.currentAmount = Math.max(0, targetUserChallenge.currentAmount - transaction.amount);
      if (targetUserChallenge.currentAmount < targetUserChallenge.targetValue) {
        targetUserChallenge.status = 'joined';
        targetUserChallenge.completedAt = null;
      }
    }
    targetUserChallenge.updatedAt = Date.now();
    await targetUserChallenge.save();
  }

  const studentProfile = await StudentProfile.findOne({ userId });
  if (studentProfile) {
    if (transaction.type === 'deposit') {
      studentProfile.totalSavings += transaction.amount;
    } else if (transaction.type === 'withdrawal') {
      studentProfile.totalWithdrawn += transaction.amount;
      studentProfile.totalSavings = Math.max(0, studentProfile.totalSavings - transaction.amount);
    }
    studentProfile.updatedAt = Date.now();
    await studentProfile.save();
  }
};

// Create a new transaction and apply its financial impact immediately only if status is completed (e.g. legacy/direct paths)
router.post('/', authorize, requireVerifiedStudent, async (req, res) => {
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

    if (goalId && userChallengeId) {
      return res.status(400).json({ error: 'Please provide either a goal id or a user challenge id, not both' });
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

    const resolvedTarget = await resolveWithdrawalTarget({
      goalId,
      userChallengeId,
      userId: req.user.id,
    });

    if (resolvedTarget.error) {
      return res.status(resolvedTarget.error.status).json({ error: resolvedTarget.error.message });
    }

    const goal = resolvedTarget.kind === 'goal' ? resolvedTarget.target : null;
    const userChallenge = resolvedTarget.kind === 'userChallenge' ? resolvedTarget.target : null;

    // Deposits are approved instantly; withdrawals stay pending until review.
    const transactionStatus = type === 'deposit'
      ? 'completed'
      : (type === 'withdrawal' ? 'pending' : (
          ['pending', 'processing', 'completed', 'failed'].includes(reqStatus)
            ? reqStatus
            : 'pending'
        ));

    if (!['pending', 'processing', 'completed', 'failed'].includes(transactionStatus)) {
      return res.status(400).json({ error: 'Invalid transaction status' });
    }

    if (type === 'withdrawal' && resolvedTarget.balance < amount) {
      return res.status(400).json({ error: 'Requested withdrawal exceeds the available balance' });
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

    if (transactionStatus === 'completed') {
      try {
        await applyTransactionImpact({ transaction, goal, userChallenge, userId: req.user.id });
      } catch (impactError) {
        await Transaction.findByIdAndDelete(transaction._id);
        return res.status(400).json({ error: impactError.message });
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

if (status === 'completed') {
      try {
        await applyTransactionImpact({ transaction, userId: transaction.userId });
      } catch (impactError) {
        transaction.status = 'failed';
        transaction.updatedAt = Date.now();
        await transaction.save();
        return res.status(400).json({ error: impactError.message });
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
    const { goalId, userChallengeId } = req.query;
    const filter = { userId: req.user.id };

    if (goalId) {
      filter.goalId = goalId;
    }

    if (userChallengeId) {
      filter.userChallengeId = userChallengeId;
    }

    const transactions = await Transaction.find(filter)
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
