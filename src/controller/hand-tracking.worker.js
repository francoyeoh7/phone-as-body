import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

let landmarker = null;
let unavailableEpoch = null;

async function createTask(delegate, canvas) {
  const fileset = await FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
  const options = {
    baseOptions: {
      modelAssetPath: "/assets/mediapipe/hand_landmarker.task",
      ...(delegate ? { delegate } : {}),
    },
    canvas,
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.62,
    minHandPresenceConfidence: 0.58,
    minTrackingConfidence: 0.58,
  };
  return HandLandmarker.createFromOptions(fileset, options);
}

self.onmessage = async ({ data }) => {
  if (data?.type === "init") {
    try {
      landmarker?.close?.();
      landmarker = await createTask("GPU", data.canvas);
    } catch {
      try {
        landmarker?.close?.();
        landmarker = await createTask(null, new OffscreenCanvas(1, 1));
      } catch (error) {
        landmarker = null;
        if (unavailableEpoch !== data.modeEpoch) {
          unavailableEpoch = data.modeEpoch;
          self.postMessage({ type: "unavailable", modeEpoch: data.modeEpoch, reason: String(error?.message ?? "init-failed") });
        }
      }
    }
    if (landmarker) self.postMessage({ type: "ready", modeEpoch: data.modeEpoch });
    return;
  }
  if (data?.type !== "detect" || !landmarker) return;
  const bitmap = data.bitmap;
  try {
    const result = landmarker.detectForVideo(bitmap, data.capturedAt);
    self.postMessage({
      type: "result",
      modeEpoch: data.modeEpoch,
      capturedAt: data.capturedAt,
      result: {
        landmarks: result?.landmarks ?? [],
        worldLandmarks: result?.worldLandmarks ?? [],
        handedness: result?.handedness ?? [],
      },
    });
  } catch (error) {
    self.postMessage({ type: "error", modeEpoch: data.modeEpoch, capturedAt: data.capturedAt, reason: String(error?.message ?? "detect-failed") });
  } finally {
    bitmap?.close?.();
  }
};
