const MOODS = new Set(['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised', 'romantic', 'energetic', 'calm', 'nostalgic', 'peaceful', 'motivational', 'melancholic']);
const GENRES = new Set(['ambient', 'blues', 'classical', 'country', 'electronic', 'folk', 'hip_hop', 'jazz', 'latin', 'metal', 'pop', 'r_and_b', 'reggae', 'rock', 'soundtrack', 'world']);
const ENERGIES = new Set(['low', 'medium', 'high']);
const CONTEXTS = new Set(['celebration', 'focus', 'late_night', 'relaxing', 'studying', 'travelling', 'workout']);
const VOCALS = new Set(['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear']);
const STRING_LIMITS = { subgenres: 40, instrumentation: 40, tags: 30 };
const ARRAY_LIMITS = { secondaryMoods: 3, subgenres: 5, listeningContexts: 5, instrumentation: 8, tags: 8 };
const ALLOWED = new Set(['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language', 'tags']);

class MetadataValidationError extends Error {
  constructor(code = 'invalid_model_output') {
    super('The music metadata response did not match the supported schema.');
    this.name = 'MetadataValidationError';
    this.code = code;
    this.retryable = false;
  }
}

function normalizeLabel(value, maxLength) {
  if (typeof value !== 'string') throw new MetadataValidationError();
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized || normalized.length > maxLength || !/^[\p{L}\p{N}_&'.]+$/u.test(normalized)) throw new MetadataValidationError();
  return normalized;
}

function list(value, field, allowedSet) {
  if (!Array.isArray(value) || value.length > ARRAY_LIMITS[field]) throw new MetadataValidationError();
  const entries = value.map((item) => {
    const normalized = normalizeLabel(item, STRING_LIMITS[field] || 40);
    if (allowedSet && !allowedSet.has(normalized)) throw new MetadataValidationError();
    return normalized;
  });
  if (new Set(entries).size !== entries.length) throw new MetadataValidationError();
  return entries;
}

function validateMusicMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !ALLOWED.has(key))) {
    throw new MetadataValidationError();
  }
  if (typeof value.mood !== 'string' || !MOODS.has(normalizeLabel(value.mood, 20))) throw new MetadataValidationError();
  if (typeof value.genre !== 'string' || !GENRES.has(normalizeLabel(value.genre, 40))) throw new MetadataValidationError();
  if (typeof value.energy !== 'string' || !ENERGIES.has(value.energy)) throw new MetadataValidationError();
  if (typeof value.vocalCharacteristics !== 'string' || !VOCALS.has(value.vocalCharacteristics)) throw new MetadataValidationError();

  const result = {
    mood: value.mood,
    genre: value.genre,
    energy: value.energy,
    vocalCharacteristics: value.vocalCharacteristics,
    secondaryMoods: list(value.secondaryMoods, 'secondaryMoods', MOODS),
    subgenres: list(value.subgenres, 'subgenres'),
    listeningContexts: list(value.listeningContexts, 'listeningContexts', CONTEXTS),
    instrumentation: list(value.instrumentation, 'instrumentation'),
    tags: list(value.tags, 'tags'),
  };
  if (value.language !== undefined && value.language !== null) {
    if (typeof value.language !== 'string' || !value.language.trim() || value.language.trim().length > 40) throw new MetadataValidationError();
    result.language = value.language.normalize('NFKC').trim();
  }
  return result;
}

module.exports = { MetadataValidationError, validateMusicMetadata };
