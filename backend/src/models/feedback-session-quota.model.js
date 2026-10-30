const mongoose = require('mongoose');

const feedbackSessionQuotaSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, minlength: 36, maxlength: 36, unique: true },
    count: { type: Number, required: true, min: 0, max: 500, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

feedbackSessionQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('FeedbackSessionQuota', feedbackSessionQuotaSchema);
