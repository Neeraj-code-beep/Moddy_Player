const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  familyId: { type: String, required: true, minlength: 36, maxlength: 36 },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, required: true, enum: ['active', 'rotated', 'revoked'], default: 'active' },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  replacedBySessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuthSession', default: null },
}, { timestamps: true, versionKey: false });

authSessionSchema.index({ tokenHash: 1 }, { unique: true });
authSessionSchema.index({ userId: 1, createdAt: -1 });
authSessionSchema.index({ familyId: 1, status: 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AuthSession || mongoose.model('AuthSession', authSessionSchema);
