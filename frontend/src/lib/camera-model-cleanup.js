const MODEL_KEYS = ['tinyFaceDetector', 'faceLandmark68Net', 'faceExpressionNet'];

export function disposeCameraModels(faceApi) {
  let disposedCount = 0;
  for (const key of MODEL_KEYS) {
    const model = faceApi?.nets?.[key];
    if (!model?.isLoaded || typeof model.dispose !== 'function') continue;
    try {
      model.dispose();
      disposedCount += 1;
    } catch {
      // Continue releasing the remaining model tensors if one is already disposed.
    }
  }
  return disposedCount;
}
