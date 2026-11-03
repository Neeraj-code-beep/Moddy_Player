const { validateMusicMetadata, MetadataValidationError } = require('./music-metadata-validation.service');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mood: { type: 'STRING', enum: ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised', 'romantic', 'energetic', 'calm', 'nostalgic', 'peaceful', 'motivational', 'melancholic'] },
    secondaryMoods: { type: 'ARRAY', items: { type: 'STRING', enum: ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised', 'romantic', 'energetic', 'calm', 'nostalgic', 'peaceful', 'motivational', 'melancholic'] } },
    genre: { type: 'STRING', enum: ['ambient', 'blues', 'classical', 'country', 'electronic', 'folk', 'hip_hop', 'jazz', 'latin', 'metal', 'pop', 'r_and_b', 'reggae', 'rock', 'soundtrack', 'world'] },
    subgenres: { type: 'ARRAY', items: { type: 'STRING' } },
    energy: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    listeningContexts: { type: 'ARRAY', items: { type: 'STRING', enum: ['celebration', 'focus', 'late_night', 'relaxing', 'studying', 'travelling', 'workout'] } },
    instrumentation: { type: 'ARRAY', items: { type: 'STRING' } },
    vocalCharacteristics: { type: 'STRING', enum: ['instrumental', 'lead_vocals', 'group_vocals', 'spoken_word', 'unclear'] },
    language: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'tags'],
};

class ProviderError extends Error {
  constructor(code, retryable) {
    super('Gemini music analysis request failed.');
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function providerErrorForStatus(status) {
  const code = status === 429 ? 'provider_rate_limited' : status === 408 ? 'provider_timeout' : status >= 500 ? 'provider_unavailable' : 'provider_rejected_request';
  return new ProviderError(code, status === 429 || status === 408 || status >= 500);
}

async function parseJsonResponse(response) {
  try { return await response.json(); } catch { throw new ProviderError('provider_invalid_response', false); }
}

async function analyzeAudioWithGemini({ audio, mimeType, config, fetchImpl = globalThis.fetch }) {
  if (!config?.enabled || !config.apiKey) throw new ProviderError('provider_not_configured', false);
  if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length > 25 * 1024 * 1024) throw new ProviderError('audio_size_unsupported', false);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  let fileName;
  try {
    let started;
    try {
      started = await fetchImpl(`${config.apiBaseUrl}/upload/v1beta/files`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': config.apiKey,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(audio.length),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: 'moddy-audio-analysis' } }),
        signal: abortController.signal,
      });
    } catch (error) {
      throw new ProviderError(error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error', true);
    }
    if (!started.ok) throw providerErrorForStatus(started.status);
    const uploadUrl = started.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new ProviderError('provider_invalid_upload_session', false);
    let parsedUploadUrl;
    try { parsedUploadUrl = new URL(uploadUrl); } catch { throw new ProviderError('provider_invalid_upload_session', false); }
    if (parsedUploadUrl.protocol !== 'https:') throw new ProviderError('provider_invalid_upload_session', false);

    let uploaded;
    try {
      uploaded = await fetchImpl(parsedUploadUrl, {
        method: 'POST',
        headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Type': mimeType },
        body: audio,
        signal: abortController.signal,
      });
    } catch (error) {
      throw new ProviderError(error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error', true);
    }
    if (!uploaded.ok) throw providerErrorForStatus(uploaded.status);
    const file = await parseJsonResponse(uploaded);
    fileName = file?.file?.name;
    const fileUri = file?.file?.uri;
    if (typeof fileName !== 'string' || !/^files\/[a-zA-Z0-9-]+$/.test(fileName) || typeof fileUri !== 'string' || !fileUri.startsWith('https://')) {
      throw new ProviderError('provider_invalid_upload_result', false);
    }

    let generated;
    try {
      generated = await fetchImpl(`${config.apiBaseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { text: 'Analyze the supplied music audio. Return only supported observable semantic descriptions, not numeric measurements. Do not infer BPM, key, danceability, acousticness, lyrics, or emotion as fact. Use the controlled vocabulary exactly. If uncertain about language, omit it. Keep tags descriptive and neutral.' },
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
          ] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      throw new ProviderError(error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error', true);
    }
    if (!generated.ok) throw providerErrorForStatus(generated.status);
    const response = await parseJsonResponse(generated);
    const candidateText = response?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    if (!candidateText) throw new ProviderError('provider_empty_response', false);
    let result;
    try { result = JSON.parse(candidateText); } catch { throw new MetadataValidationError(); }
    return validateMusicMetadata(result);
  } catch (error) {
    if (error instanceof ProviderError || error instanceof MetadataValidationError) throw error;
    if (error?.name === 'AbortError') throw new ProviderError('provider_timeout', true);
    throw new ProviderError('provider_network_error', true);
  } finally {
    clearTimeout(timeout);
    if (fileName) {
      try {
        const deleted = await fetchImpl(`${config.apiBaseUrl}/v1beta/${fileName}`, {
          method: 'DELETE', headers: { 'x-goog-api-key': config.apiKey },
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10_000)),
        });
        if (!deleted.ok && deleted.status !== 404) console.warn('[music-ai] Provider file cleanup failed', { status: deleted.status });
      } catch (error) {
        console.warn('[music-ai] Provider file cleanup failed', { errorName: error?.name || 'Error' });
      }
    }
  }
}

module.exports = { ProviderError, RESPONSE_SCHEMA, analyzeAudioWithGemini };
