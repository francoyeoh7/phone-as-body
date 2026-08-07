import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export function createWorkerHandler({
  FilesetResolverImpl = FilesetResolver,
  HandLandmarkerImpl = HandLandmarker,
  OffscreenCanvasCtor = globalThis.OffscreenCanvas,
  postMessage,
} = {}) {
  let landmarker = null;
  let landmarkerEpoch = null;
  let latestInitToken = 0;
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
      numHands: 1,
      minHandDetectionConfidence: 0.62,
      minHandPresenceConfidence: 0.58,
      minTrackingConfidence: 0.58,
    });
  };

  return async ({ data }) => {
    if (data?.type === "init") {
      const initToken = ++latestInitToken;
      const modeEpoch = data.modeEpoch;
      landmarker?.close?.();
      landmarker = null;
      landmarkerEpoch = null;
      const isCurrentInit = () => initToken === latestInitToken;
      let created = null;
      try {
        created = await createTask("GPU", data.canvas);
      } catch {
        if (!isCurrentInit()) return;
        try {
          created = await createTask(null, new OffscreenCanvasCtor(1, 1));
        } catch (error) {
          if (!isCurrentInit()) return;
          if (unavailableEpoch !== modeEpoch) {
            unavailableEpoch = modeEpoch;
            postMessage?.({ type: "unavailable", modeEpoch, reason: String(error?.message ?? "init-failed") });
          }
          return;
        }
      }
      if (!isCurrentInit()) {
        created?.close?.();
        return;
      }
      landmarker = created;
      landmarkerEpoch = modeEpoch;
      postMessage?.({ type: "ready", modeEpoch });
      return;
    }
    if (data?.type !== "detect") return;
    const bitmap = data.bitmap;
    if (!landmarker || data.modeEpoch !== landmarkerEpoch) {
      bitmap?.close?.();
      return;
    }
    try {
      const result = landmarker.detectForVideo(bitmap, data.capturedAt);
      postMessage?.({
        type: "result",
        modeEpoch: data.modeEpoch,
        capturedAt: data.capturedAt,
        rotation: data.rotation,
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
