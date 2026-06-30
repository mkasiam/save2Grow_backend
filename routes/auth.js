const express = require("express");
const User = require("../models/User");
const StudentProfile = require("../models/StudentProfile");
const { generateToken, authorize } = require("../middleware/auth");

const router = express.Router();

// Create a new user account and return a signed auth token for immediate login.
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password, role, university, studentId } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const userRole = role || "student";

    if (userRole === "student" && (!university || !studentId)) {
      return res.status(400).json({
        error: "University and student ID are required for student registration",
      });
    }

    const user = new User({
      name,
      email,
      phone,
      password,
      role: userRole,
    });

    const savedUser = await user.save();

    let studentProfile = null;
    if (userRole === "student") {
      try {
        studentProfile = await new StudentProfile({
          userId: savedUser._id,
          university,
          studentId,
        }).save();
      } catch (profileError) {
        await User.deleteOne({ _id: savedUser._id });
        throw profileError;
      }
    }

    const token = generateToken(savedUser._id, savedUser.role);

    res.status(201).json({
      token,
      user: {
        id: savedUser._id,
        name: savedUser.name,
        email: savedUser.email,
        phone: savedUser.phone,
        role: savedUser.role,
        profilePicture: savedUser.profilePicture,
        createdAt: savedUser.createdAt,
        updatedAt: savedUser.updatedAt,
      },
      studentProfile: studentProfile
        ? {
            id: studentProfile._id,
            userId: studentProfile.userId,
            university: studentProfile.university,
            studentId: studentProfile.studentId,
            totalSavings: studentProfile.totalSavings,
            totalWithdrawn: studentProfile.totalWithdrawn,
            verificationStatus: studentProfile.verificationStatus,
            createdAt: studentProfile.createdAt,
            updatedAt: studentProfile.updatedAt,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate credentials and return a fresh auth token plus a minimal user payload.
router.post("/login", async (req, res) => {
  console.log("I have got your request", req.body);
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Please provide email and password" });
    }

    const user = await User.findOne({ email }).select("+password").populate("studentProfile");

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user._id, user.role);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        university: user.university,
        studentId: user.studentId,
        totalSavings: user.totalSavings,
        totalWithdrawn: user.totalWithdrawn,
        verificationStatus: user.verificationStatus,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Return the currently authenticated user based on the decoded auth token.
router.get("/me", authorize, async (req, res) => {
  try {
    res.json({
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      university: req.user.university,
      studentId: req.user.studentId,
      totalSavings: req.user.totalSavings,
      totalWithdrawn: req.user.totalWithdrawn,
      verificationStatus: req.user.verificationStatus,
      profilePicture: req.user.profilePicture,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
