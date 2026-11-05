const MAX_ANALYSIS_AUDIO_BYTES = 25 * 1024 * 1024;
const GEMINI_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/m4a', 'audio/opus', 'audio/webm']);

class AudioAssetError extends Error {
  constructor(code, retryable = false) {
    super('The stored audio could not be prepared for music analysis.');
    this.name = 'AudioAssetError';
    this.code = code;
    this.retryable = retryable;
  }
}

function assertTrustedAssetUrl(value, endpoint) {
  let assetUrl;
  let baseUrl;
  try { assetUrl = new URL(value); baseUrl = new URL(endpoint); } catch { throw new AudioAssetError('asset_url_invalid'); }
  if (assetUrl.protocol !== 'https:' || assetUrl.origin !== baseUrl.origin || !assetUrl.pathname.startsWith(baseUrl.pathname.replace(/\/$/, '') + '/')) {
    throw new AudioAssetError('asset_origin_rejected');
  }
  return assetUrl;
}

async function readBoundedBody(response, limit) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limit) throw new AudioAssetError('audio_size_unsupported');
  if (!response.body) throw new AudioAssetError('audio_body_missing', true);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    let part;
    try { part = await reader.read(); } catch { throw new AudioAssetError('asset_transfer_failed', true); }
    const { done, value } = part;
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new AudioAssetError('audio_size_unsupported');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

async function retrieveSongAudio(song, {
  getDeliveryUrl = (url) => require('./storage.service').getDeliveryUrl(url),
  fetchImpl = globalThis.fetch,
  imageKitEndpoint = process.env.IMAGEKIT_URL_ENDPOINT,
  timeoutMs = 30_000,
} = {}) {
  if (!song?.audio || !song?.audioMimeType || !GEMINI_MIME_TYPES.has(song.audioMimeType)) throw new AudioAssetError('audio_format_unsupported');
  if (!imageKitEndpoint) throw new AudioAssetError('asset_source_unavailable', true);
  let deliveryUrl;
  try { deliveryUrl = await getDeliveryUrl(song.audio); } catch { throw new AudioAssetError('asset_signing_failed'); }
  const safeUrl = assertTrustedAssetUrl(deliveryUrl, imageKitEndpoint);
  let response;
  try {
    response = await fetchImpl(safeUrl, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    throw new AudioAssetError(timeout ? 'asset_fetch_timeout' : 'asset_provider_unavailable', true);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const code = retryable ? 'asset_provider_unavailable' : response.status === 401 || response.status === 403 ? 'asset_access_denied' : 'asset_fetch_rejected';
    throw new AudioAssetError(code, retryable);
  }
  const audio = await readBoundedBody(response, MAX_ANALYSIS_AUDIO_BYTES);
  if (!audio.length) throw new AudioAssetError('audio_body_missing', true);
  return { audio, mimeType: song.audioMimeType };
}

module.exports = { AudioAssetError, GEMINI_MIME_TYPES, MAX_ANALYSIS_AUDIO_BYTES, assertTrustedAssetUrl, readBoundedBody, retrieveSongAudio };
