const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, minlength: 36, maxlength: 36 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true, select: false },
    songId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    event: { type: String, required: true, enum: ['like', 'dislike', 'skip', 'completed'] },
    intention: { type: String, enum: ['match', 'cheer_up', 'calm_down', 'surprise'], default: 'match' },
  },
  { timestamps: true },
);

feedbackSchema.index({ sessionId: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

module.exports = mongoose.model('Feedback', feedbackSchema);
