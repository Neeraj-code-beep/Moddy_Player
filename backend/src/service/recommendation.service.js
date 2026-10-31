const SUPPORTED_MOODS = new Set(['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised']);
const MOOD_ALIASES = new Map([
  ['anger', 'angry'],
  ['fear', 'fearful'],
  ['happiness', 'happy'],
  ['sadness', 'sad'],
  ['surprise', 'surprised'],
]);
const INTENTIONS = new Set(['match', 'cheer_up', 'calm_down', 'surprise']);
const ENERGIES = new Set(['low', 'medium', 'high']);
const MOOD_VALENCE = { sad: 0, angry: 1, disgusted: 1, fearful: 1, neutral: 2, surprised: 3, happy: 4 };
const MOOD_ENERGY = { sad: 'low', angry: 'high', disgusted: 'medium', fearful: 'medium', neutral: 'medium', surprised: 'medium', happy: 'high' };
const CANDIDATE_LIMIT = 500;
const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 50;

function normalizeMood(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const compact = normalized.replace(/_/g, ' ');
  const canonical = MOOD_ALIASES.get(compact) || MOOD_ALIASES.get(normalized) || compact;
  return SUPPORTED_MOODS.has(canonical) ? canonical : null;
}

function normalizeIntention(value = 'match') {
  if (typeof value !== 'string') return null;
  const intention = value.trim().toLowerCase();
  return INTENTIONS.has(intention) ? intention : null;
}

function validateRecommendationRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'The recommendation request must be a JSON object.' };
  }
  if (Object.keys(body).some((key) => !['mood', 'intention', 'limit'].includes(key))) {
    return { error: 'Only mood, intention, and limit are accepted.' };
  }
  if (body.mood !== undefined && body.mood !== null &&
      (typeof body.mood !== 'string' || body.mood.trim().length > 40)) {
    return { error: 'mood must be a string of 40 characters or fewer.' };
  }
  const intention = normalizeIntention(body.intention);
  if (!intention) return { error: 'intention must be match, cheer_up, calm_down, or surprise.' };
  let limit = DEFAULT_RESULT_LIMIT;
  if (body.limit !== undefined) {
    if (!Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > MAX_RESULT_LIMIT) {
      return { error: `limit must be an integer from 1 to ${MAX_RESULT_LIMIT}.` };
    }
    limit = body.limit;
  }
  const requestedMood = typeof body.mood === 'string' ? body.mood.trim() : '';
  return {
    value: {
      mood: normalizeMood(requestedMood),
      requestedMood: requestedMood || null,
      intention,
      limit,
    },
  };
}

function songId(song) {
  return String(song?._id ?? song?.id ?? '');
}

function energyFor(song, mood) {
  const energy = typeof song?.energy === 'string' ? song.energy.trim().toLowerCase() : '';
  return ENERGIES.has(energy) ? energy : MOOD_ENERGY[mood] || null;
}

function scoreSong(song, { mood, intention }) {
  const candidateMood = normalizeMood(song?.mood);
  const energy = energyFor(song, candidateMood);
  const hasStoredEnergy = typeof song?.energy === 'string' && ENERGIES.has(song.energy.trim().toLowerCase());
  const reasons = [];
  let score = 0;

  if (intention === 'match') {
    if (mood && candidateMood === mood) {
      score += 100;
      reasons.push(`matches the ${mood} mood`);
    } else if (mood && candidateMood) {
      const distance = Math.abs(MOOD_VALENCE[candidateMood] - MOOD_VALENCE[mood]);
      if (distance === 1) {
        score += 25;
        reasons.push('has a nearby mood profile');
      }
    } else if (!mood) {
      score += 20;
      reasons.push('available for an open mood choice');
    } else {
      score += 5;
      reasons.push('included because the catalog has no recognized mood tag');
    }
  } else if (intention === 'cheer_up') {
    score += (MOOD_VALENCE[candidateMood] ?? 1) * 15;
    if (candidateMood === 'happy') reasons.push('has an uplifting mood tag');
    if (energy === 'high') {
      score += 20;
      reasons.push(hasStoredEnergy ? 'has a high energy profile' : 'estimated as high energy from its mood tag');
    } else if (energy === 'medium') {
      score += 10;
      reasons.push(hasStoredEnergy ? 'has a moderate energy profile' : 'estimated as moderate energy from its mood tag');
    }
    if (mood && candidateMood && MOOD_VALENCE[candidateMood] > MOOD_VALENCE[mood]) {
      score += 15;
      reasons.push('moves toward a more uplifting mood');
    }
  } else if (intention === 'calm_down') {
    if (energy === 'low') {
      score += 45;
      reasons.push(hasStoredEnergy ? 'has a low energy profile' : 'estimated as low energy from its mood tag');
    } else if (energy === 'medium') {
      score += 20;
      reasons.push(hasStoredEnergy ? 'has a moderate energy profile' : 'estimated as moderate energy from its mood tag');
    }
    if (candidateMood === 'neutral') {
      score += 20;
      reasons.push('has a neutral mood tag');
    }
    if (candidateMood === 'angry' || candidateMood === 'fearful') {
      score -= 10;
      reasons.push('reduced for a more intense mood tag');
    }
    if (mood && energy && MOOD_ENERGY[mood] === 'high' && energy !== 'high') {
      score += 15;
      reasons.push('moves to a lower energy profile');
    }
  } else {
    if (mood && candidateMood && candidateMood !== mood) {
      score += 60;
      reasons.push('offers a different mood from the selected one');
    } else if (!mood || !candidateMood) {
      score += 25;
      reasons.push('adds variety to the catalog');
    } else {
      score += 5;
      reasons.push('keeps one familiar mood in the mix');
    }
  }

  const tags = Array.isArray(song?.tags) ? song.tags : [];
  if (intention === 'cheer_up' && tags.some((tag) => ['uplifting', 'energetic'].includes(String(tag).toLowerCase()))) {
    score += 5;
    reasons.push('has an uplifting descriptive tag');
  }
  if (intention === 'calm_down' && tags.some((tag) => ['calm', 'relaxing', 'ambient'].includes(String(tag).toLowerCase()))) {
    score += 5;
    reasons.push('has a calm descriptive tag');
  }
  if (reasons.length === 0) reasons.push('selected from available catalog metadata');
  return { score, reasons, mood: candidateMood, energy };
}

function compareStable(left, right) {
  const leftDate = new Date(left.song?.createdAt || 0).getTime() || 0;
  const rightDate = new Date(right.song?.createdAt || 0).getTime() || 0;
  if (leftDate !== rightDate) return rightDate - leftDate;
  return songId(left.song).localeCompare(songId(right.song));
}

function rankSongs(songs, request) {
  const ranked = songs.map((song) => ({ song, ...scoreSong(song, request) }));
  const selected = [];
  const remaining = [...ranked];
  const artistCounts = new Map();

  while (remaining.length) {
    remaining.sort((left, right) => {
      const leftArtist = String(left.song?.artist || '').trim().toLowerCase();
      const rightArtist = String(right.song?.artist || '').trim().toLowerCase();
      const leftGenre = String(left.song?.genre || '').trim().toLowerCase();
      const rightGenre = String(right.song?.genre || '').trim().toLowerCase();
      const leftPenalty = (artistCounts.get(`artist:${leftArtist}`) || 0) * 15 + (artistCounts.get(`genre:${leftGenre}`) || 0) * 5;
      const rightPenalty = (artistCounts.get(`artist:${rightArtist}`) || 0) * 15 + (artistCounts.get(`genre:${rightGenre}`) || 0) * 5;
      return (right.score - rightPenalty) - (left.score - leftPenalty) || compareStable(left, right);
    });
    const next = remaining.shift();
    const artist = String(next.song?.artist || '').trim().toLowerCase();
    const genre = String(next.song?.genre || '').trim().toLowerCase();
    const artistPenalty = (artistCounts.get(`artist:${artist}`) || 0) * 15;
    const genrePenalty = (artistCounts.get(`genre:${genre}`) || 0) * 5;
    const reasons = [...next.reasons];
    if (artistPenalty || genrePenalty) reasons.push('ranking adjusted to avoid repeating an artist or genre');
    if (artist) artistCounts.set(`artist:${artist}`, (artistCounts.get(`artist:${artist}`) || 0) + 1);
    if (genre) artistCounts.set(`genre:${genre}`, (artistCounts.get(`genre:${genre}`) || 0) + 1);
    selected.push({
      song: next.song,
      score: next.score - artistPenalty - genrePenalty,
      reason: reasons.join('; '),
    });
  }
  return selected;
}

async function getRecommendations(songModel, request, visibilityFilter = {}) {
  const candidates = await songModel.find(visibilityFilter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(CANDIDATE_LIMIT)
    .lean();
  const recommendations = rankSongs(candidates, request).slice(0, request.limit);
  return recommendations;
}

module.exports = {
  CANDIDATE_LIMIT,
  MAX_RESULT_LIMIT,
  getRecommendations,
  normalizeIntention,
  normalizeMood,
  rankSongs,
  scoreSong,
  validateRecommendationRequest,
};
