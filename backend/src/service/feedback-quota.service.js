const FEEDBACK_SESSION_LIMIT = 500;
const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function reserveFeedbackSlot(quotaModel, sessionId, now = new Date(), initialCount = 0) {
  if (!Number.isSafeInteger(initialCount) || initialCount < 0 || initialCount >= FEEDBACK_SESSION_LIMIT) return null;
  const filter = { sessionId, count: { $lt: FEEDBACK_SESSION_LIMIT } };
  // A pipeline computes count once for both insert and update. Combining
  // $inc.count with $setOnInsert.count causes MongoDB ConflictingUpdateOperators.
  const update = [{
    $set: {
      sessionId: { $ifNull: ['$sessionId', sessionId] },
      count: { $add: [{ $ifNull: ['$count', initialCount] }, 1] },
      expiresAt: new Date(now.getTime() + FEEDBACK_RETENTION_MS),
    },
  }];
  const options = { new: true, upsert: true, updatePipeline: true };

  try {
    return await quotaModel.findOneAndUpdate(filter, update, options);
  } catch (error) {
    // Concurrent first writes can race to insert the unique session key. Retry
    // without upsert so the existing counter is incremented atomically.
    if (error?.code !== 11000) throw error;
    return quotaModel.findOneAndUpdate(filter, update, { ...options, upsert: false });
  }
}

module.exports = { FEEDBACK_RETENTION_MS, FEEDBACK_SESSION_LIMIT, reserveFeedbackSlot };
