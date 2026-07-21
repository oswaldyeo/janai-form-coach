// MediaPipe Tasks Vision loader with GPU→CPU fallback.
//
// The MediaPipe library is imported *dynamically* (not as a static top-level
// import) so the app shell boots even when the CDN is unreachable (offline,
// headless CI). Failure to load is surfaced to the caller, never thrown as an
// uncaught module-init error.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let _mp = null; // cached { PoseLandmarker, FilesetResolver, DrawingUtils }

async function loadLib() {
  if (_mp) return _mp;
  const mod = await import(/* @vite-ignore */ `${CDN}`);
  _mp = {
    PoseLandmarker: mod.PoseLandmarker,
    FilesetResolver: mod.FilesetResolver,
    DrawingUtils: mod.DrawingUtils,
  };
  return _mp;
}

/**
 * Create a PoseLandmarker, preferring the GPU delegate and falling back to CPU.
 * @returns {Promise<{landmarker, delegate:'GPU'|'CPU', lib}>}
 */
export async function createPoseLandmarker() {
  const lib = await loadLib();
  const vision = await lib.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });

  try {
    const landmarker = await lib.PoseLandmarker.createFromOptions(vision, options('GPU'));
    return { landmarker, delegate: 'GPU', lib };
  } catch (gpuErr) {
    console.warn('[pose] GPU delegate unavailable, falling back to CPU', gpuErr);
    const landmarker = await lib.PoseLandmarker.createFromOptions(vision, options('CPU'));
    return { landmarker, delegate: 'CPU', lib };
  }
}

export { MODEL, CDN };
