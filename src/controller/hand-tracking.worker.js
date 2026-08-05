import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export function createWorkerHandler({
  FilesetResolverImpl = FilesetResolver,
  HandLandmarkerImpl = HandLandmarker,
  OffscreenCanvasCtor = globalThis.OffscreenCanvas,
  postMessage,
} = {}) {
  let landmarker = null;
  let unavailableEpoch = null;
  const createTask = async (delegate, canvas) => {
    const fileset = await FilesetResolverImpl.forVisionTasks("/assets/mediapipe/wasm");
    return HandLandmarkerImpl.createFromOptions(fileset, {
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
    });
  };

  return async ({ data }) => {
    if (data?.type === "init") {
      try {
        landmarker?.close?.();
        landmarker = await createTask("GPU", data.canvas);
      } catch {
        try {
          landmarker?.close?.();
          landmarker = await createTask(null, new OffscreenCanvasCtor(1, 1));
        } catch (error) {
          landmarker = null;
          if (unavailableEpoch !== data.modeEpoch) {
            unavailableEpoch = data.modeEpoch;
            postMessage?.({ type: "unavailable", modeEpoch: data.modeEpoch, reason: String(error?.message ?? "init-failed") });
          }
        }
      }
      if (landmarker) postMessage?.({ type: "ready", modeEpoch: data.modeEpoch });
      return;
    }
    if (data?.type !== "detect" || !landmarker) return;
    const bitmap = data.bitmap;
    try {
      const result = landmarker.detectForVideo(bitmap, data.capturedAt);
      postMessage?.({
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
      postMessage?.({ type: "error", modeEpoch: data.modeEpoch, capturedAt: data.capturedAt, reason: String(error?.message ?? "detect-failed") });
    } finally {
      bitmap?.close?.();
    }
  };
}

if (typeof self !== "undefined") {
  self.onmessage = createWorkerHandler({ postMessage: (message) => self.postMessage(message) });
}
