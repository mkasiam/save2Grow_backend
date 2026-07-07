const express = require('express');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Challenge = require('../models/Challenge');
const UserChallenge = require('../models/UserChallenge');
const Notification = require('../models/Notification');
const Transaction = require('../models/Transaction');
const { authorize, isAdmin, requireVerifiedStudent } = require('../middleware/auth');

const router = express.Router();

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const buildWithdrawalBreakdown = ({ baseAmount, completed }) => {
  const penaltyRate = completed ? 0 : 0.05;
  const penaltyFee = roundMoney(baseAmount * penaltyRate);
  const payoutAmount = roundMoney(Math.max(baseAmount - penaltyFee, 0));

  return { penaltyRate, penaltyFee, payoutAmount };
};

const createUserNotification = async ({ userId, title, body, type, metadata }) => {
  await Notification.create({
    userId,
    title,
    body,
    type,
    metadata,
  });
};

router.post('/request', authorize, requireVerifiedStudent, async (req, res) => {
  try {
    const { challengeId, userChallengeId, adminNote } = req.body;

    if (!challengeId && !userChallengeId) {
      return res.status(400).json({ error: 'Please provide a challenge id or user challenge id' });
    }

    let challenge = null;
    let userChallenge = null;

    if (userChallengeId) {
      userChallenge = await UserChallenge.findOne({ _id: userChallengeId, userId: req.user.id }).populate('challengeId');
      if (!userChallenge) {
        return res.status(404).json({ error: 'User challenge not found' });
      }
      challenge = userChallenge.challengeId;
    } else if (challengeId) {
      challenge = await Challenge.findById(challengeId);
      if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found' });
      }

      userChallenge = await UserChallenge.findOne({ userId: req.user.id, challengeId: challenge._id }).populate('challengeId');
      if (!userChallenge) {
        return res.status(404).json({ error: 'Join the challenge before requesting a withdrawal' });
      }
    }

    if (!challenge || !userChallenge) {
      return res.status(400).json({ error: 'Unable to resolve the withdrawal target' });
    }

    const openRequest = await WithdrawalRequest.findOne({
      userId: req.user.id,
      challengeId: challenge._id,
      status: 'pending',
    });

    if (openRequest) {
      return res.status(409).json({ error: 'You already have a pending withdrawal request for this challenge' });
    }

    const completed = userChallenge.status === 'completed' || userChallenge.currentProgress >= challenge.targetValue || challenge.status === 'completed';
    const baseAmount = roundMoney(userChallenge.currentProgress || 0);

    if (baseAmount <= 0) {
      return res.status(400).json({ error: 'No available savings were found for this challenge' });
    }

    const breakdown = buildWithdrawalBreakdown({ baseAmount, completed });
    const requestType = completed ? 'completed_payout' : 'early_withdrawal';

    const withdrawalRequest = await WithdrawalRequest.create({
      userId: req.user.id,
      challengeId: challenge._id,
      userChallengeId: userChallenge._id,
      requestType,
      initialDepositAmount: baseAmount,
      penaltyRate: breakdown.penaltyRate,
      penaltyFee: breakdown.penaltyFee,
      payoutAmount: breakdown.payoutAmount,
      status: 'pending',
      adminNote: typeof adminNote === 'string' ? adminNote.trim() : '',
    });

    res.status(201).json({
      withdrawalRequest,
      breakdown: {
        ...breakdown,
        completed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', authorize, async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find({ userId: req.user.id })
      .populate('challengeId')
      .populate('userChallengeId')
      .sort('-createdAt');

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/admin', authorize, isAdmin, async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find()
      .populate('userId', 'name email role')
      .populate('challengeId')
      .populate('userChallengeId')
      .populate('reviewedBy', 'name email role')
      .sort('-createdAt');

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/status', authorize, isAdmin, async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid withdrawal status' });
    }

    const withdrawalRequest = await WithdrawalRequest.findById(req.params.id)
      .populate('challengeId')
      .populate('userChallengeId');

    if (!withdrawalRequest) {
      return res.status(404).json({ error: 'Withdrawal request not found' });
    }

    if (withdrawalRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal request is already processed' });
    }

    withdrawalRequest.status = status;
    withdrawalRequest.reviewedBy = req.user.id;
    withdrawalRequest.adminNote = typeof adminNote === 'string' ? adminNote.trim() : withdrawalRequest.adminNote;
    withdrawalRequest.updatedAt = Date.now();

    if (status === 'approved') {
      withdrawalRequest.approvedAt = Date.now();

      await Transaction.create({
        userId: withdrawalRequest.userId,
        userChallengeId: withdrawalRequest.userChallengeId?._id || withdrawalRequest.userChallengeId,
        withdrawalRequestId: withdrawalRequest._id,
        type: 'withdrawal',
        amount: withdrawalRequest.payoutAmount,
        description: `Withdrawal request approved for ${withdrawalRequest.challengeId?.title || 'challenge'}`,
        note: 'Approved & processing for manual bank transfer',
        paymentMethod: 'bank_transfer',
        status: 'pending',
      });

      await createUserNotification({
        userId: withdrawalRequest.userId,
        title: 'Withdrawal approved & processing',
        body: `Your request is approved. Tk ${roundMoney(withdrawalRequest.payoutAmount).toLocaleString()} is now queued for manual transfer.`,
        type: 'withdrawal',
        metadata: {
          withdrawalRequestId: withdrawalRequest._id,
          challengeId: withdrawalRequest.challengeId?._id || withdrawalRequest.challengeId,
          status: 'approved',
        },
      });
    } else {
      withdrawalRequest.rejectedAt = Date.now();

      await createUserNotification({
        userId: withdrawalRequest.userId,
        title: 'Withdrawal request rejected',
        body: `Your request for ${withdrawalRequest.challengeId?.title || 'this challenge'} was rejected by the admin.`,
        type: 'withdrawal',
        metadata: {
          withdrawalRequestId: withdrawalRequest._id,
          challengeId: withdrawalRequest.challengeId?._id || withdrawalRequest.challengeId,
          status: 'rejected',
        },
      });
    }

    await withdrawalRequest.save();

    const populatedRequest = await WithdrawalRequest.findById(withdrawalRequest._id)
      .populate('userId', 'name email role')
      .populate('challengeId')
      .populate('userChallengeId')
      .populate('reviewedBy', 'name email role');

    res.json(populatedRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;