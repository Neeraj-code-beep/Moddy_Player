export async function installMediaMocks(page, { delayMetadata = false } = {}) {
  await page.addInitScript((shouldDelayMetadata) => {
    const mediaState = new WeakMap();
    window.__mediaCalls = [];
    window.__rejectNextPlay = false;
    window.__delayMediaMetadata = shouldDelayMetadata;

    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() { return mediaState.get(this)?.duration ?? Number.NaN; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return mediaState.get(this)?.currentTime ?? 0; },
      set(value) {
        const current = mediaState.get(this) || { duration: Number.NaN, currentTime: 0 };
        current.currentTime = Number(value);
        mediaState.set(this, current);
        this.dispatchEvent(new Event('timeupdate'));
      },
    });

    HTMLMediaElement.prototype.play = function mockPlay() {
      window.__mediaCalls.push({ action: 'play', src: this.currentSrc || this.src });
      if (window.__rejectNextPlay) {
        window.__rejectNextPlay = false;
        return Promise.reject(new DOMException('Playback rejected by test mock.', 'NotAllowedError'));
      }
      this.dispatchEvent(new Event('loadstart'));
      const setMetadata = () => {
        mediaState.set(this, { duration: 180, currentTime: 0 });
        this.dispatchEvent(new Event('loadedmetadata'));
        return Promise.resolve();
      };
      if (window.__delayMediaMetadata) {
        return new Promise((resolve) => {
          window.__releaseMediaMetadata = () => { setMetadata(); resolve(); };
        });
      }
      return setMetadata();
    };
    HTMLMediaElement.prototype.pause = function mockPause() {
      window.__mediaCalls.push({ action: 'pause', src: this.currentSrc || this.src });
    };
  }, delayMetadata);
}

export async function installCameraMock(page, initialMode = 'granted') {
  await page.addInitScript((mode) => {
    const stopKey = 'pw-camera-stop-count';
    const state = { calls: 0, stops: Number(localStorage.getItem(stopKey) || 0), mode };
    window.__cameraState = state;
    const stream = new MediaStream();
    const tracks = [{ stop: () => {
      state.stops += 1;
      localStorage.setItem(stopKey, String(state.stops));
    } }];
    Object.defineProperty(stream, 'getTracks', { configurable: true, value: () => tracks });
    const mediaDevices = navigator.mediaDevices || {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        state.calls += 1;
        if (state.mode === 'denied') throw new DOMException('Permission denied by test mock.', 'NotAllowedError');
        if (state.mode === 'missing') throw new DOMException('No camera by test mock.', 'NotFoundError');
        return stream;
      },
    });
  }, initialMode);
}

export async function installFaceApiMock(page, { delayed = false, failure = false } = {}) {
  await page.addInitScript(({ shouldDelay, shouldFail }) => {
    window.__faceApiOptions = { delayed: shouldDelay, failure: shouldFail };
    window.__faceApiState = { loads: [], disposals: [], detections: 0 };
  }, { shouldDelay: delayed, shouldFail: failure });
  await page.route(/face-api/i, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      const state = window.__faceApiState;
      const options = window.__faceApiOptions;
      const model = (name) => ({
        isLoaded: false,
        async loadFromUri(path) {
          state.loads.push({ name, path });
          this.isLoaded = true;
          if (options.delayed) await new Promise((resolve) => { window.__releaseFaceApiLoad = resolve; });
          if (options.failure) throw new Error('Mocked face model failure.');
        },
        dispose() { state.disposals.push(name); this.isLoaded = false; },
      });
      export const nets = {
        tinyFaceDetector: model('tinyFaceDetector'),
        faceLandmark68Net: model('faceLandmark68Net'),
        faceExpressionNet: model('faceExpressionNet'),
      };
      export class TinyFaceDetectorOptions {}
      export function detectAllFaces() {
        state.detections += 1;
        return { withFaceLandmarks() { return this; }, withFaceExpressions() { return Promise.resolve([]); } };
      }
    `,
  }));
}
