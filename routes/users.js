const express = require('express');
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const { authorize, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin-only endpoint: get all students
router.get('/', authorize, isAdmin, async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).populate('studentProfile');
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch a user's profile document so the mobile app can show account details.
router.get('/:id', authorize, async (req, res) => {
  try {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const user = await User.findById(req.params.id).populate('studentProfile');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update the editable profile fields for a single user record.
router.put('/:id', authorize, async (req, res) => {
  try {
    const { name, phone, profilePicture } = req.body;

    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    let user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Please provide a valid name' });
      }
      user.name = name.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== 'string' || !phone.trim()) {
        return res.status(400).json({ error: 'Please provide a valid phone number' });
      }
      user.phone = phone.trim();
    }

    if (profilePicture !== undefined) {
      user.profilePicture = profilePicture || null;
    }
    user.updatedAt = Date.now();

    await user.save();
    await user.populate('studentProfile');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return lightweight user statistics that power dashboard and profile summaries.
router.get('/:id/stats', authorize, async (req, res) => {
  try {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const user = await User.findById(req.params.id).populate('studentProfile');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      totalSavings: user.totalSavings || 0,
      totalWithdrawn: user.totalWithdrawn || 0,
      verificationStatus: user.verificationStatus || null,
      joinedDate: user.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin-only endpoint: change a student's verificationStatus
router.put('/:id/verify', authorize, isAdmin, async (req, res) => {
  try {
    const { verificationStatus } = req.body;
    if (!['pending', 'verified', 'rejected'].includes(verificationStatus)) {
      return res.status(400).json({ error: 'Invalid verification status' });
    }

    const profile = await StudentProfile.findOne({ userId: req.params.id });
    if (!profile) {
      return res.status(404).json({ error: 'Student profile not found' });
    }

    profile.verificationStatus = verificationStatus;
    profile.updatedAt = Date.now();
    await profile.save();

    res.json({
      message: `Verification status updated to ${verificationStatus}`,
      profile,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
