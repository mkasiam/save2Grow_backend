const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number'],
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false,
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student',
  },
  profilePicture: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Hash passwords before persistence so plain-text credentials are never stored in MongoDB.
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare a login attempt against the stored password hash.
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Relationship to StudentProfile
userSchema.virtual('studentProfile', {
  ref: 'StudentProfile',
  localField: '_id',
  foreignField: 'userId',
  justOne: true,
});

// Backward compatibility virtual getters
userSchema.virtual('university').get(function() {
  return this.studentProfile ? this.studentProfile.university : undefined;
});

userSchema.virtual('studentId').get(function() {
  return this.studentProfile ? this.studentProfile.studentId : undefined;
});

userSchema.virtual('totalSavings').get(function() {
  return this.studentProfile ? this.studentProfile.totalSavings : 0;
});

userSchema.virtual('totalWithdrawn').get(function() {
  return this.studentProfile ? this.studentProfile.totalWithdrawn : 0;
});

userSchema.virtual('verificationStatus').get(function() {
  return this.studentProfile ? this.studentProfile.verificationStatus : undefined;
});

module.exports = mongoose.model('User', userSchema);
