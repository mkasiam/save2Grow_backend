const express = require('express');
const https = require('https');
const querystring = require('querystring');
const Transaction = require('../models/Transaction');
const Goal = require('../models/Goal');
const UserChallenge = require('../models/UserChallenge');
const StudentProfile = require('../models/StudentProfile');
const { authorize } = require('../middleware/auth');

const router = express.Router();

const STORE_ID = process.env.SSL_STORE_ID;
const STORE_PASSWORD = process.env.SSL_STORE_PASSWORD;
const SESSION_API = process.env.SSL_SESSION_API || 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
const VALIDATION_API = process.env.SSL_VALIDATION_API || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
const CALLBACK_BASE_URL = process.env.SSL_CALLBACK_BASE_URL || 'https://save2-grow-backend.vercel.app';
const DEFAULT_CURRENCY = 'BDT';

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const postForm = (targetUrl, payload) => new Promise((resolve, reject) => {
  const body = querystring.stringify(payload);
  const url = new URL(targetUrl);

  const request = https.request(
    {
      method: 'POST',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (response) => {
      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          resolve(raw);
        }
      });
    }
  );

  request.on('error', reject);
  request.write(body);
  request.end();
});

const renderStatusPage = (title, message, extraScript = '') => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:#f3f7f4; color:#10201a; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; padding:24px; }
      .card { max-width:520px; background:#fff; border:1px solid #e1ece6; border-radius:20px; padding:24px; box-shadow:0 16px 40px rgba(16,32,26,.08); }
      h1 { margin:0 0 12px; font-size:24px; }
      p { margin:0; line-height:1.6; color:#5e776c; }
      .meta { margin-top:14px; font-size:13px; color:#335c4b; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
      <p class="meta">You can return to the Save2Grow app after this page closes.</p>
    </div>
    ${extraScript}
  </body>
</html>`;

const updateCompletedDeposit = async ({ transaction, amount }) => {
  const depositAmount = roundMoney(amount || transaction.amount);

  const goal = transaction.goalId
    ? await Goal.findOne({ _id: transaction.goalId, userId: transaction.userId })
    : null;

  const userChallenge = transaction.userChallengeId
    ? await UserChallenge.findOne({ _id: transaction.userChallengeId, userId: transaction.userId }).populate('challengeId')
    : null;

  if (goal) {
    goal.currentAmount += depositAmount;
    if (goal.currentAmount >= goal.targetAmount) {
      goal.status = 'completed';
    }
    goal.updatedAt = Date.now();
    await goal.save();
  }

  if (userChallenge) {
    userChallenge.currentProgress += depositAmount;
    if (userChallenge.challengeId && userChallenge.currentProgress >= userChallenge.challengeId.targetValue) {
      userChallenge.status = 'completed';
      userChallenge.completedAt = Date.now();
    }
    await userChallenge.save();
  }

  const studentProfile = await StudentProfile.findOne({ userId: transaction.userId });
  if (studentProfile) {
    studentProfile.totalSavings += depositAmount;
    studentProfile.updatedAt = Date.now();
    await studentProfile.save();
  }
};

router.post('/sslcommerz/initiate', authorize, async (req, res) => {
  try {
    if (!STORE_ID || !STORE_PASSWORD) {
      return res.status(500).json({ error: 'SSLCommerz credentials are not configured' });
    }

    const { goalId, userChallengeId, amount, description, paymentMethod } = req.body;
    const normalizedAmount = roundMoney(amount);
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ error: 'Please provide a valid amount' });
    }

    if (!goalId && !userChallengeId) {
      return res.status(400).json({ error: 'Please provide a valid goal id or user challenge id' });
    }

    if (description !== undefined && !normalizedDescription) {
      return res.status(400).json({ error: 'Description cannot be empty' });
    }

    let goal = null;
    if (goalId) {
      goal = await Goal.findOne({ _id: goalId, userId: req.user.id });
      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }
    }

    let userChallenge = null;
    if (userChallengeId) {
      userChallenge = await UserChallenge.findOne({ _id: userChallengeId, userId: req.user.id }).populate('challengeId');
      if (!userChallenge) {
        return res.status(404).json({ error: 'User challenge not found' });
      }
    }

    const transaction = new Transaction({
      userId: req.user.id,
      goalId: goalId || null,
      userChallengeId: userChallengeId || null,
      type: 'deposit',
      amount: normalizedAmount,
      description: normalizedDescription || 'SSLCommerz deposit',
      note: `Gateway session created${paymentMethod ? ` via ${paymentMethod}` : ''}`,
      paymentMethod: 'sslcommerz',
      status: 'pending',
    });

    await transaction.save();

    const sessionPayload = {
      store_id: STORE_ID,
      store_passwd: STORE_PASSWORD,
      total_amount: normalizedAmount,
      currency: DEFAULT_CURRENCY,
      tran_id: transaction.transactionId,
      success_url: `${CALLBACK_BASE_URL}/api/payments/sslcommerz/success?tran_id=${encodeURIComponent(transaction.transactionId)}`,
      fail_url: `${CALLBACK_BASE_URL}/api/payments/sslcommerz/fail?tran_id=${encodeURIComponent(transaction.transactionId)}`,
      cancel_url: `${CALLBACK_BASE_URL}/api/payments/sslcommerz/cancel?tran_id=${encodeURIComponent(transaction.transactionId)}`,
      ipn_url: `${CALLBACK_BASE_URL}/api/payments/sslcommerz/ipn`,
      shipping_method: 'NO',
      product_name: goal?.title || userChallenge?.challengeId?.title || 'Save2Grow Deposit',
      product_category: 'Savings',
      product_profile: 'general',
      cus_name: req.user.name || 'Save2Grow User',
      cus_email: req.user.email || 'customer@example.com',
      cus_add1: req.user.studentProfile?.university || 'Bangladesh',
      cus_city: 'Dhaka',
      cus_state: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: req.user.phone || '01700000000',
      ship_name: req.user.name || 'Save2Grow User',
      ship_add1: req.user.studentProfile?.university || 'Bangladesh',
      ship_city: 'Dhaka',
      ship_state: 'Dhaka',
      ship_postcode: '1000',
      ship_country: 'Bangladesh',
      value_a: String(req.user.id),
      value_b: goalId || '',
      value_c: userChallengeId || '',
      value_d: transaction.transactionId,
    };

    const sessionResponse = await postForm(SESSION_API, sessionPayload);

    if (!sessionResponse || sessionResponse.status !== 'SUCCESS' || !sessionResponse.GatewayPageURL) {
      transaction.status = 'failed';
      transaction.note = `${transaction.note || ''} | SSLCommerz session creation failed`.trim();
      transaction.updatedAt = Date.now();
      await transaction.save();

      return res.status(502).json({
        error: 'Unable to create SSLCommerz session',
        details: sessionResponse,
      });
    }

    transaction.note = `${transaction.note || ''} | SSLCommerz session created`.trim();
    transaction.updatedAt = Date.now();
    await transaction.save();

    res.status(201).json({
      transactionId: transaction.transactionId,
      transaction,
      gatewayPageURL: sessionResponse.GatewayPageURL,
      sessionKey: sessionResponse.sessionkey || null,
      raw: sessionResponse,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.all('/sslcommerz/success', async (req, res) => {
  try {
    const tranId = req.query.tran_id || req.body?.tran_id;
    const valId = req.query.val_id || req.body?.val_id;

    if (!tranId) {
      return res.status(400).send(renderStatusPage('Payment successful', 'Transaction reference is missing.'));
    }

    const transaction = await Transaction.findOne({ transactionId: tranId });
    if (!transaction) {
      return res.status(404).send(renderStatusPage('Payment successful', 'Transaction record was not found.'));
    }

    if (transaction.status !== 'completed') {
      let validationResponse = null;

      if (valId) {
        validationResponse = await postForm(VALIDATION_API, {
          val_id: valId,
          store_id: STORE_ID,
          store_passwd: STORE_PASSWORD,
          format: 'json',
        });
      }

      const validationLooksGood = validationResponse
        ? ['VALID', 'VALIDATED', 'SUCCESS'].includes(String(validationResponse.status || '').toUpperCase()) ||
          ['VALID', 'VALIDATED', 'SUCCESS'].includes(String(validationResponse.val_status || '').toUpperCase())
        : true;

      if (!validationLooksGood) {
        transaction.status = 'failed';
        transaction.note = `${transaction.note || ''} | SSLCommerz validation failed`.trim();
        transaction.updatedAt = Date.now();
        await transaction.save();

        return res.status(400).send(renderStatusPage('Payment failed', 'The payment could not be validated.'));
      }

      transaction.status = 'completed';
      transaction.updatedAt = Date.now();
      await transaction.save();

      await updateCompletedDeposit({ transaction, amount: transaction.amount });
    }

    const redirectScript = `
      <script>
        setTimeout(function () {
          window.location.href = 'save2grow://payment-complete?tran_id=${encodeURIComponent(tranId)}&status=success';
        }, 1200);
      </script>`;

    res.send(renderStatusPage('Payment successful', 'Your deposit has been recorded successfully.', redirectScript));
  } catch (error) {
    res.status(500).send(renderStatusPage('Payment error', error.message));
  }
});

router.all('/sslcommerz/fail', async (req, res) => {
  try {
    const tranId = req.query.tran_id || req.body?.tran_id;
    if (tranId) {
      const transaction = await Transaction.findOne({ transactionId: tranId });
      if (transaction && transaction.status !== 'completed') {
        transaction.status = 'failed';
        transaction.updatedAt = Date.now();
        transaction.note = `${transaction.note || ''} | SSLCommerz marked failed`.trim();
        await transaction.save();
      }
    }

    res.send(renderStatusPage('Payment failed', 'The SSLCommerz transaction did not complete.'));
  } catch (error) {
    res.status(500).send(renderStatusPage('Payment error', error.message));
  }
});

router.all('/sslcommerz/cancel', async (req, res) => {
  try {
    const tranId = req.query.tran_id || req.body?.tran_id;
    if (tranId) {
      const transaction = await Transaction.findOne({ transactionId: tranId });
      if (transaction && transaction.status !== 'completed') {
        transaction.status = 'failed';
        transaction.updatedAt = Date.now();
        transaction.note = `${transaction.note || ''} | SSLCommerz cancelled`.trim();
        await transaction.save();
      }
    }

    res.send(renderStatusPage('Payment cancelled', 'You cancelled the payment flow.'));
  } catch (error) {
    res.status(500).send(renderStatusPage('Payment error', error.message));
  }
});

router.all('/sslcommerz/ipn', async (req, res) => {
  try {
    const tranId = req.body?.tran_id || req.query?.tran_id;
    const valId = req.body?.val_id || req.query?.val_id;

    if (!tranId) {
      return res.status(400).json({ error: 'tran_id is required' });
    }

    const transaction = await Transaction.findOne({ transactionId: tranId });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status === 'completed') {
      return res.json({ message: 'Already processed' });
    }

    let validationResponse = null;
    if (valId) {
      validationResponse = await postForm(VALIDATION_API, {
        val_id: valId,
        store_id: STORE_ID,
        store_passwd: STORE_PASSWORD,
        format: 'json',
      });
    }

    const validationLooksGood = validationResponse
      ? ['VALID', 'VALIDATED', 'SUCCESS'].includes(String(validationResponse.status || '').toUpperCase()) ||
        ['VALID', 'VALIDATED', 'SUCCESS'].includes(String(validationResponse.val_status || '').toUpperCase())
      : true;

    if (!validationLooksGood) {
      transaction.status = 'failed';
      transaction.updatedAt = Date.now();
      await transaction.save();
      return res.status(400).json({ error: 'Validation failed' });
    }

    transaction.status = 'completed';
    transaction.updatedAt = Date.now();
    await transaction.save();

    await updateCompletedDeposit({ transaction, amount: transaction.amount });

    res.json({ message: 'Payment validated and recorded', transaction });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;