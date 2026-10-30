import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposeCameraModels } from '../src/lib/camera-model-cleanup.js';

test('disposes only the loaded models used by camera mood detection', () => {
  const calls = [];
  const faceApi = {
    nets: {
      tinyFaceDetector: { isLoaded: true, dispose: () => calls.push('detector') },
      faceLandmark68Net: { isLoaded: false, dispose: () => calls.push('landmarks') },
      faceExpressionNet: { isLoaded: true, dispose: () => calls.push('expressions') },
      faceRecognitionNet: { isLoaded: true, dispose: () => calls.push('unused') },
    },
  };

  assert.equal(disposeCameraModels(faceApi), 2);
  assert.deepEqual(calls, ['detector', 'expressions']);
});

test('continues model cleanup after one tensor disposal fails', () => {
  let expressionDisposed = false;
  const faceApi = {
    nets: {
      tinyFaceDetector: { isLoaded: true, dispose: () => { throw new Error('already disposed'); } },
      faceExpressionNet: { isLoaded: true, dispose: () => { expressionDisposed = true; } },
    },
  };

  assert.equal(disposeCameraModels(faceApi), 1);
  assert.equal(expressionDisposed, true);
});
