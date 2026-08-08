import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { DoorDefenseDirector } from "../src/desktop/DoorDefenseDirector.js";
import { createObjectiveState } from "../src/shared/objectives.js";

const TRIGGER = new THREE.Vector3(0, 1.05, -26.7);

function createHarness({
  storyState = "reach-door",
  distance = 1.4,
  reducedMotion = false,
  handTracking = null,
  doorPosition = [0, 0, -28.88],
  triggerPosition = [0, 1.05, -26.7],
  inwardNormal = [0, 0, 1],
  manifestExitDoor = null,
} = {}) {
  const activeTrigger = manifestExitDoor?.triggerPosition ?? triggerPosition;
  const activeNormal = manifestExitDoor?.inwardNormal ?? inwardNormal;
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(new THREE.Vector3(...activeTrigger)).add(new THREE.Vector3(...activeNormal).multiplyScalar(distance));
  camera.lookAt(...doorPosition.map((value, index) => index === 1 ? value + 1.45 : value));
  camera.updateMatrixWorld(true);

  const savedPose = {
    body: { x: camera.position.x, y: 1.05, z: camera.position.z },
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    cameraYaw: 0.37,
    cameraPitch: -0.12,
    cameraRenderYaw: 0.34,
    cameraRenderPitch: -0.1,
  };
  const cameraSamples = [];
  const player = {
    snapshotPose: vi.fn(() => structuredClone(savedPose)),
    beginCinematic: vi.fn(),
    setCinematicCamera: vi.fn((position, target) => {
      cameraSamples.push({ position: position.clone(), target: target.clone() });
    }),
    restorePose: vi.fn(),
    endCinematic: vi.fn(),
  };
  const root = new THREE.Group();
  root.position.set(...doorPosition);
  const leafPivot = new THREE.Group();
  const handlePivot = new THREE.Group();
  const lockBolt = new THREE.Object3D();
  const gapShadow = new THREE.Object3D();
  const braceRig = new THREE.Group();
  lockBolt.position.set(1.13, -0.08, 0);
  leafPivot.add(handlePivot, lockBolt);
  root.add(gapShadow, leafPivot);
  const exitDoor = {
    root,
    leafPivot,
    handlePivot,
    lockBolt,
    gapShadow,
    braceRig,
    triggerPosition: new THREE.Vector3(...triggerPosition),
    inwardNormal: new THREE.Vector3(...inwardNormal),
  };
  const story = createObjectiveState(storyState);
  const ui = { setDoorDefense: vi.fn(), setPrompt: vi.fn(), setObjective: vi.fn() };
  const audio = { cue: vi.fn() };
  const sendControllerEvent = vi.fn();
  const onThreatStart = vi.fn();
  const experience = {
    camera,
    objects: {
      exitDoor,
      ...(manifestExitDoor ? {
        environment: { manifest: { tasks: { "exit-door": manifestExitDoor } } },
      } : {}),
    },
  };
  const director = new DoorDefenseDirector({
    experience,
    player,
    story,
    ui,
    audio,
    sendControllerEvent,
    onThreatStart,
    reducedMotion,
    handTracking,
  });

  return {
    director,
    experience,
    exitDoor,
    player,
    savedPose,
    cameraSamples,
    story,
    ui,
    audio,
    sendControllerEvent,
    onThreatStart,
  };
}

function startBracing(harness) {
  harness.director.update(0.016);
  harness.director.update(1.2);
  harness.director.handlePresence({ context: "door-defense", ready: true, active: true });
}

describe("door defense director", () => {
  it("derives the brace camera anchor from a rotated door inward normal", () => {
    const harness = createHarness({
      doorPosition: [23, 0, -29.6],
      triggerPosition: [20.82, 1.05, -29.6],
      inwardNormal: [-1, 0, 0],
    });

    harness.director.update(0.016);

    expect(harness.director.bracePosition.x).toBeCloseTo(21.24, 8);
    expect(harness.director.bracePosition.y).toBeCloseTo(1.6, 8);
    expect(harness.director.bracePosition.z).toBeCloseTo(-29.6, 8);
    expect(harness.director.braceTarget.x).toBeCloseTo(22.9, 8);
    expect(harness.director.braceTarget.z).toBeCloseTo(-29.6, 8);
  });

  it("prefers the manifest trigger and inward normal over stale prop anchors", () => {
    const harness = createHarness({
      doorPosition: [23, 0, -29.6],
      triggerPosition: [0, 1.05, -26.7],
      inwardNormal: [0, 0, 1],
      manifestExitDoor: {
        position: [23, 0, -29.6],
        rotationY: -Math.PI / 2,
        triggerPosition: [20.82, 1.05, -29.6],
        inwardNormal: [-1, 0, 0],
      },
    });

    harness.director.update(0.016);

    expect(harness.director.triggerPosition.toArray()).toEqual([20.82, 1.05, -29.6]);
    expect(harness.director.inwardNormal.toArray()).toEqual([-1, 0, 0]);
    expect(harness.director.bracePosition.x).toBeCloseTo(21.24, 8);
    expect(harness.director.bracePosition.y).toBeCloseTo(1.6, 8);
    expect(harness.director.bracePosition.z).toBeCloseTo(-29.6, 8);
  });

  it("acquires only for reach-door at the inclusive proximity boundary", () => {
    const wrongStory = createHarness({ storyState: "restore-power" });
    const tooFar = createHarness({ distance: 2.351 });
    const boundary = createHarness({ distance: 2.35 });

    wrongStory.director.update(0.016);
    tooFar.director.update(0.016);
    boundary.director.update(0.016);

    expect(wrongStory.player.snapshotPose).not.toHaveBeenCalled();
    expect(tooFar.player.snapshotPose).not.toHaveBeenCalled();
    expect(boundary.player.snapshotPose).toHaveBeenCalledOnce();
    expect(boundary.player.beginCinematic).toHaveBeenCalledOnce();
  });

  it("snapshots before cinematic control and starts the threat exactly once", () => {
    const harness = createHarness();

    harness.director.update(0.016);
    harness.director.update(0.4);

    expect(harness.player.snapshotPose).toHaveBeenCalledOnce();
    expect(harness.player.snapshotPose.mock.invocationCallOrder[0])
      .toBeLessThan(harness.player.beginCinematic.mock.invocationCallOrder[0]);
    expect(harness.player.beginCinematic).toHaveBeenCalledOnce();
    expect(harness.onThreatStart).toHaveBeenCalledOnce();
    expect(harness.player.setCinematicCamera).toHaveBeenCalled();
    expect(harness.director.isCinematic()).toBe(true);
    expect(harness.audio.cue).toHaveBeenCalledWith("lock-twist");
    expect(harness.audio.cue).toHaveBeenCalledWith("door-rattle");
    expect(harness.audio.cue).toHaveBeenCalledWith("door-impact");
  });

  it("requests a fresh presence attempt at exactly 1.2 seconds", () => {
    const harness = createHarness();
    harness.director.update(0.016);

    harness.director.update(1.199);
    expect(harness.sendControllerEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "gesture-mode",
      context: "door-defense",
    }));

    harness.director.update(0.001);
    expect(harness.sendControllerEvent).toHaveBeenCalledWith({
      type: "gesture-mode",
      mode: "presence",
      context: "door-defense",
      baseline: "fresh",
    });
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: true,
      progress: 0,
      status: "calibrating",
    });
  });

  it("waits through inactive calibration and starts bracing on the first active sample", () => {
    const harness = createHarness();
    harness.director.update(0.016);
    harness.director.update(1.2);

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: false,
      active: false,
    })).toBe(false);
    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: false,
    })).toBe(true);
    expect(harness.sendControllerEvent).not.toHaveBeenCalledWith({
      type: "haptics",
      active: false,
      pattern: "brace",
    });

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: true,
    })).toBe(true);
    expect(harness.exitDoor.braceRig.visible).toBe(true);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: true,
      progress: 0,
      status: "bracing",
    });
    expect(harness.sendControllerEvent).toHaveBeenCalledWith({
      type: "haptics",
      active: true,
      pattern: "brace",
    });
  });

  it("returns to exploration when camera calibration never becomes ready", () => {
    const harness = createHarness();
    harness.director.update(0.016);
    harness.director.update(1.2);

    harness.director.update(2.999);
    expect(harness.director.isCinematic()).toBe(true);
    expect(harness.player.restorePose).not.toHaveBeenCalled();

    harness.director.update(0.001);

    expect(harness.director.isCinematic()).toBe(false);
    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: false,
      progress: 0,
      status: "dormant",
    });
    expect(harness.sendControllerEvent).toHaveBeenLastCalledWith({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
  });

  it("resets progress and haptics synchronously on the first bracing release", () => {
    const harness = createHarness();
    startBracing(harness);

    harness.director.update(1.5);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.375,
      status: "bracing",
    }));

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: false,
    })).toBe(true);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: true,
      progress: 0,
      status: "failed",
    });
    expect(harness.exitDoor.braceRig.visible).toBe(false);
    expect(harness.sendControllerEvent).toHaveBeenLastCalledWith({
      type: "haptics",
      active: false,
      pattern: "brace",
    });
  });

  it("pauses progress and haptics during the held-state loss grace", () => {
    const handState = { phase: "held", fresh: true };
    const handTracking = {
      usesFallback: vi.fn(() => false),
      snapshot: vi.fn(() => ({ ...handState })),
      beginTask: vi.fn(() => true),
      endTask: vi.fn(),
    };
    const harness = createHarness({ handTracking });
    harness.director.beginBracing();

    harness.director.update(1);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.25,
      status: "bracing",
    }));
    harness.sendControllerEvent.mockClear();

    handState.fresh = false;
    harness.director.update(0.5);

    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.25,
      status: "unstable",
    }));
    expect(harness.sendControllerEvent).toHaveBeenCalledExactlyOnceWith({
      type: "haptics",
      active: false,
      pattern: "brace",
    });
  });

  it("uses an explicit full-screen hold when camera hand tracking is unavailable", () => {
    const handTracking = {
      usesFallback: vi.fn(() => false),
      snapshot: vi.fn(() => ({ phase: "tracking", calibrated: true, fresh: false })),
      beginTask: vi.fn(() => true),
      endTask: vi.fn(),
      hand: { fallback: false },
    };
    const harness = createHarness({ handTracking });
    harness.director.update(0.016);
    harness.director.update(1.2);

    expect(harness.director.setFallbackHolding(true, { explicit: true })).toBe(true);
    harness.director.update(1);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.25,
      status: "bracing",
    }));

    expect(harness.director.setFallbackHolding(false, { explicit: true })).toBe(true);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0,
      status: "failed",
    }));
  });

  it("reuses persistent hand calibration and advances only from a held brace", () => {
    let handState = { phase: "tracking", calibrated: true, fresh: true };
    const handTracking = {
      usesFallback: vi.fn(() => false),
      snapshot: vi.fn(() => ({ ...handState })),
      beginTask: vi.fn(() => true),
      endTask: vi.fn(),
      hand: { fallback: false },
    };
    const harness = createHarness({ handTracking });

    harness.director.update(0.016);
    harness.director.update(1.2);
    expect(handTracking.beginTask).toHaveBeenCalledExactlyOnceWith({
      context: "door-defense",
      requiredAction: "brace",
      skipCalibration: true,
    });
    expect(harness.sendControllerEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "gesture-mode",
      mode: "presence",
    }));

    harness.director.update(0.1);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0,
      status: "awaiting",
    }));

    handState = { phase: "held", calibrated: true, fresh: true, sample: { state: "tracked", fresh: true } };
    harness.director.update(0.016);
    harness.director.update(0.5);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.125,
      status: "bracing",
    }));
  });

  it("emits immutable progress snapshots across bracing updates", () => {
    const harness = createHarness();
    startBracing(harness);

    harness.director.update(1.5);
    const firstProgress = harness.ui.setDoorDefense.mock.calls.at(-1)[0];
    expect(firstProgress.progress).toBe(0.375);

    harness.director.update(0.5);
    const secondProgress = harness.ui.setDoorDefense.mock.calls.at(-1)[0];
    expect(firstProgress.progress).toBe(0.375);
    expect(secondProgress.progress).toBe(0.5);
    expect(secondProgress).not.toBe(firstProgress);
  });

  it("starts a fresh zero-progress attempt at exactly 0.7 seconds after failure", () => {
    const harness = createHarness();
    startBracing(harness);
    harness.director.handlePresence({ context: "door-defense", ready: true, active: false });
    harness.sendControllerEvent.mockClear();

    harness.director.update(0.699);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(harness.sendControllerEvent).not.toHaveBeenCalled();

    harness.director.update(0.001);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: true,
      progress: 0,
      status: "calibrating",
    });
    expect(harness.sendControllerEvent).toHaveBeenCalledExactlyOnceWith({
      type: "gesture-mode",
      mode: "presence",
      context: "door-defense",
      baseline: "fresh",
    });
  });

  it("requires a new inactive sample before accepting active on a retry", () => {
    const harness = createHarness();
    startBracing(harness);
    harness.director.handlePresence({ context: "door-defense", ready: true, active: false });
    harness.director.update(0.7);

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: true,
    })).toBe(false);
    expect(harness.exitDoor.braceRig.visible).toBe(false);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "calibrating",
      progress: 0,
    }));

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: false,
    })).toBe(true);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "awaiting",
      progress: 0,
    }));

    expect(harness.director.handlePresence({
      context: "door-defense",
      ready: true,
      active: true,
    })).toBe(true);
    expect(harness.exitDoor.braceRig.visible).toBe(true);
  });

  it("secures at four uninterrupted seconds and restores after the full one-second return", () => {
    const harness = createHarness();
    startBracing(harness);

    harness.director.update(3.999);
    expect(harness.story.current()).toBe("reach-door");
    expect(harness.player.restorePose).not.toHaveBeenCalled();

    harness.director.update(0.001);
    expect(harness.story.current()).toBe("secured");
    expect(harness.ui.setObjective).toHaveBeenCalledWith(harness.story.label());
    expect(harness.audio.cue).toHaveBeenCalledWith("door-latch");
    expect(harness.audio.cue.mock.calls.filter(([name]) => name === "door-latch")).toHaveLength(1);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: false,
      progress: 0,
      status: "secured",
    });
    expect(harness.sendControllerEvent).toHaveBeenLastCalledWith({
      type: "haptics",
      active: false,
      pattern: "brace",
    });
    expect(harness.player.restorePose).not.toHaveBeenCalled();

    harness.director.update(0.999);
    expect(harness.player.restorePose).not.toHaveBeenCalled();
    harness.director.update(0.001);

    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.director.isCinematic()).toBe(false);
    expect(harness.story.current()).toBe("secured");
    expect(harness.exitDoor.lockBolt.position.x).toBeCloseTo(1.21, 8);
    harness.director.update(5);
    expect(harness.audio.cue.mock.calls.filter(([name]) => name === "door-latch")).toHaveLength(1);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.ui.showCompletion).toBeUndefined();
  });

  it("aborts without success effects when the story rejects door-defended", () => {
    const harness = createHarness();
    const rejectedStory = {
      current: vi.fn(() => "reach-door"),
      dispatch: vi.fn(() => ({ accepted: false, reason: "out-of-order" })),
    };
    harness.director.story = rejectedStory;
    startBracing(harness);

    harness.director.update(4);

    expect(rejectedStory.dispatch).toHaveBeenCalledExactlyOnceWith("door-defended");
    expect(harness.audio.cue).not.toHaveBeenCalledWith("door-latch");
    expect(harness.ui.setDoorDefense).not.toHaveBeenCalledWith(expect.objectContaining({ status: "secured" }));
    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.exitDoor.braceRig.visible).toBe(false);
    expect(harness.director.isCinematic()).toBe(false);
  });

  it("carries an oversized bracing delta through success and the full return", () => {
    const harness = createHarness();
    startBracing(harness);

    harness.director.update(5);

    expect(harness.story.current()).toBe("secured");
    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.director.isCinematic()).toBe(false);
    expect(harness.exitDoor.lockBolt.position.x).toBeCloseTo(1.21, 8);
    expect(harness.audio.cue.mock.calls.filter(([name]) => name === "door-latch")).toHaveLength(1);
  });

  it("preserves the secured latch when an in-progress return is aborted", () => {
    const harness = createHarness();
    startBracing(harness);
    harness.director.update(4);
    harness.director.update(0.4);

    expect(harness.director.abort()).toBe(true);

    expect(harness.story.current()).toBe("secured");
    expect(harness.exitDoor.lockBolt.position.x).toBeCloseTo(1.21, 8);
    expect(harness.exitDoor.leafPivot.rotation.y).toBe(0);
    expect(harness.exitDoor.gapShadow.scale.x).toBe(1);
    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.audio.cue.mock.calls.filter(([name]) => name === "door-latch")).toHaveLength(1);
  });

  it("routes fallback holding through the same fail, retry, and hold path", () => {
    const harness = createHarness();
    harness.director.update(0.016);
    harness.director.update(1.2);

    expect(harness.director.setFallbackHolding(true)).toBe(true);
    harness.director.update(1);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0.25,
      status: "bracing",
    }));

    expect(harness.director.setFallbackHolding(false)).toBe(true);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 0,
      status: "failed",
    }));
    harness.director.update(0.7);
    expect(harness.director.setFallbackHolding(true)).toBe(false);
    expect(harness.director.setFallbackHolding(false)).toBe(true);
    expect(harness.director.setFallbackHolding(true)).toBe(true);
    harness.director.update(4);
    expect(harness.story.current()).toBe("secured");
  });

  it("ignores wrong-context, not-ready, and stale presence samples", () => {
    const harness = createHarness();
    harness.director.update(0.016);
    harness.director.update(1.2);
    harness.ui.setDoorDefense.mockClear();
    harness.sendControllerEvent.mockClear();

    expect(harness.director.handlePresence({ context: "found-phone", ready: true, active: true })).toBe(false);
    expect(harness.director.handlePresence({ context: "door-defense", ready: false, active: true })).toBe(false);
    expect(harness.ui.setDoorDefense).not.toHaveBeenCalled();
    expect(harness.sendControllerEvent).not.toHaveBeenCalled();

    startBracing(harness);
    harness.director.update(4);
    expect(harness.director.handlePresence({ context: "door-defense", ready: true, active: false })).toBe(false);
    expect(harness.story.current()).toBe("secured");
  });

  it("animates door roots and removes only camera impact in reduced motion", () => {
    const animated = createHarness();
    const reduced = createHarness({ reducedMotion: true });
    startBracing(animated);
    startBracing(reduced);
    animated.cameraSamples.length = 0;
    reduced.cameraSamples.length = 0;

    animated.director.update(0.17);
    reduced.director.update(0.17);

    expect(animated.exitDoor.handlePivot.rotation.z).not.toBe(0);
    expect(animated.exitDoor.leafPivot.rotation.y).not.toBe(0);
    expect(animated.exitDoor.lockBolt.position.x).not.toBe(1.13);
    expect(animated.exitDoor.gapShadow.scale.x).not.toBe(1);
    expect(reduced.exitDoor.leafPivot.rotation.y).toBeCloseTo(animated.exitDoor.leafPivot.rotation.y, 8);
    expect(reduced.cameraSamples.at(-1).position.toArray())
      .not.toEqual(animated.cameraSamples.at(-1).position.toArray());
  });

  it("aborts once with exact pose, hidden output, pulse mode, and no success", () => {
    const harness = createHarness();
    startBracing(harness);

    expect(harness.director.abort()).toBe(true);
    expect(harness.director.abort()).toBe(false);

    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.exitDoor.braceRig.visible).toBe(false);
    expect(harness.ui.setDoorDefense).toHaveBeenLastCalledWith({
      visible: false,
      progress: 0,
      status: "dormant",
    });
    expect(harness.sendControllerEvent).toHaveBeenCalledWith({
      type: "haptics",
      active: false,
      pattern: "brace",
    });
    expect(harness.sendControllerEvent).toHaveBeenLastCalledWith({
      type: "gesture-mode",
      mode: "pulse",
      context: null,
      baseline: "fresh",
    });
    expect(harness.story.current()).toBe("reach-door");
    expect(harness.director.isCinematic()).toBe(false);
  });

  it("requires leaving and re-entering the trigger zone after abort", () => {
    const harness = createHarness();
    startBracing(harness);
    harness.director.abort();

    harness.director.update(0.016);
    expect(harness.player.snapshotPose).toHaveBeenCalledOnce();
    expect(harness.onThreatStart).toHaveBeenCalledOnce();
    expect(harness.director.isCinematic()).toBe(false);

    harness.experience.camera.position.copy(TRIGGER).add(new THREE.Vector3(0, 0, 2.5));
    harness.director.update(0.016);
    expect(harness.player.snapshotPose).toHaveBeenCalledOnce();

    harness.experience.camera.position.copy(TRIGGER).add(new THREE.Vector3(0, 0, 1.4));
    harness.director.update(0.016);
    expect(harness.player.snapshotPose).toHaveBeenCalledTimes(2);
    expect(harness.onThreatStart).toHaveBeenCalledTimes(2);
    expect(harness.director.isCinematic()).toBe(true);
  });

  it("does not emit a duplicate haptics-off event when aborting after failure", () => {
    const harness = createHarness();
    startBracing(harness);
    harness.director.handlePresence({ context: "door-defense", ready: true, active: false });

    harness.director.abort();

    expect(harness.sendControllerEvent.mock.calls.filter(([event]) => (
      event.type === "haptics" && event.active === false
    ))).toHaveLength(1);
  });

  it("destroy is idempotent during an attempt and prevents reacquisition", () => {
    const harness = createHarness();
    startBracing(harness);

    harness.director.destroy();
    harness.director.destroy();
    harness.director.update(10);

    expect(harness.player.restorePose).toHaveBeenCalledExactlyOnceWith(harness.savedPose);
    expect(harness.player.endCinematic).toHaveBeenCalledOnce();
    expect(harness.player.snapshotPose).toHaveBeenCalledOnce();
    expect(harness.story.current()).toBe("reach-door");
    expect(harness.exitDoor.braceRig.visible).toBe(false);
  });
});
