const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, required: true, enum: ['user', 'admin'], default: 'user' },
  avatarUrl: { type: String, maxlength: 2048, default: null },
  bio: { type: String, maxlength: 500, default: '' },
  status: { type: String, required: true, enum: ['active', 'disabled'], default: 'active' },
  lastLoginAt: { type: Date, default: null },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, result) {
      delete result.passwordHash;
      delete result.__v;
      return result;
    },
  },
});

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
