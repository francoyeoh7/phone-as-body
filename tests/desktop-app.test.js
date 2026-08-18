import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopApp, classifySceneError } from "../src/desktop/DesktopApp.js";
import { FoundPhoneDirector } from "../src/desktop/FoundPhoneDirector.js";
import { HandTrackingDirector } from "../src/desktop/HandTrackingDirector.js";
import { InventoryState } from "../src/desktop/InventoryState.js";
import { createGameAudio } from "../src/desktop/audio.js";
import { createDesktopUI } from "../src/desktop/ui.js";
import { EnvironmentLoadError } from "../src/desktop/environment/EnvironmentLoader.js";
import { VillageDirector } from "../src/desktop/VillageDirector.js";

const { createSceneMock } = vi.hoisted(() => ({ createSceneMock: vi.fn() }));

vi.mock("../src/desktop/create-scene.js", () => ({ createScene: createSceneMock }));

vi.mock("lucide", () => ({
  ChevronLeft: {},
  ChevronRight: {},
  createIcons: vi.fn(),
  Keyboard: {},
  Mic: {},
  Package: {},
  RotateCcw: {},
  ScanLine: {},
  Smartphone: {},
  Volume2: {},
  Wifi: {},
  WifiOff: {},
  X: {},
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

function createEventTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    pointerLockElement: null,
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    exitPointerLock: vi.fn(),
  };
}

function createElement() {
  const attributes = new Map();
  return {
    hidden: false,
    dataset: {},
    style: {},
    textContent: "",
    innerHTML: "",
    src: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn((name, value) => attributes.set(name, String(value))),
    getAttribute: vi.fn((name) => attributes.get(name) ?? null),
  };
}

function createRoot() {
  const elements = new Map();
  const root = {
    innerHTML: "",
    querySelector: vi.fn((selector) => {
      if (!elements.has(selector)) elements.set(selector, createElement());
      return elements.get(selector);
    }),
  };
  return { root, elements };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createSceneStartHarness() {
  const fakeWindow = createEventTarget();
  fakeWindow.matchMedia = vi.fn(() => ({ matches: false }));
  const fakeDocument = createEventTarget();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("location", { search: "", href: "https://game.test/" });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 617));
  vi.stubGlobal("performance", { now: vi.fn(() => 1000) });

  const app = new DesktopApp({});
  const rightHandFlashlight = {
    load: vi.fn(async () => true),
    update: vi.fn(),
    destroy: vi.fn(),
  };
  app.createRightHandFlashlight = vi.fn(() => rightHandFlashlight);
  app.ui = {
    elements: {
      sceneHost: {},
      pairingStatus: createElement(),
      startButton: createElement(),
      fallbackButton: createElement(),
      sceneRetryButton: createElement(),
    },
    showLoading: vi.fn(),
    showPairing: vi.fn(),
    showSceneError: vi.fn(),
    setCleanView: vi.fn(),
    setPrompt: vi.fn(),
    setObjective: vi.fn(),
    setSubtitle: vi.fn(),
    setPlayerTranscript: vi.fn(),
    setVoiceRecording: vi.fn(),
  };
  app.audio = {
    start: vi.fn(),
    cue: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  };
  app.phone = { send: vi.fn(), destroy: vi.fn() };
  return { app, fakeDocument, fakeWindow, rightHandFlashlight };
}

function createStartableScene() {
  const body = { translation: vi.fn(() => ({ x: 0, y: 1.05, z: 0 })) };
  const characterController = {
    enableAutostep: vi.fn(),
    enableSnapToGround: vi.fn(),
    setApplyImpulsesToDynamicBodies: vi.fn(),
  };
  const world = {
    createRigidBody: vi.fn(() => body),
    createCollider: vi.fn(() => ({})),
    createCharacterController: vi.fn(() => characterController),
    removeCharacterController: vi.fn(),
    removeCollider: vi.fn(),
    removeRigidBody: vi.fn(),
  };
  const bodyDescription = { setTranslation: vi.fn(() => bodyDescription) };
  const camera = {
    add: vi.fn(),
    remove: vi.fn(),
    position: { x: 0, y: 1.6, z: 0 },
  };
  return {
    RAPIER: {
      RigidBodyDesc: { kinematicPositionBased: vi.fn(() => bodyDescription) },
      ColliderDesc: { capsule: vi.fn(() => ({})) },
    },
    world,
    camera,
    renderer: { domElement: createElement() },
    interactables: [],
    staticOccluderRoots: [],
    spawn: { position: [0, 1.05, 0], yaw: 0 },
    objects: {
      environment: { manifest: { lights: [] }, lights: { all: [], byRole: {}, byId: {} } },
      foundPhone: { enabled: true, setHeld: vi.fn() },
      heldFuse: null,
      ceilingLights: [],
      flashlight: { visible: true },
      stormLight: { intensity: 0 },
    },
    dispose: vi.fn(),
  };
}

function createTickHarness({ owner = null } = {}) {
  const doorDefense = {
    update: vi.fn(),
    isCinematic: vi.fn(() => owner === "door"),
  };
  const foundPhone = {
    update: vi.fn(),
    isInspecting: vi.fn(() => owner === "phone"),
  };
  const shadowQuest = {
    update: vi.fn(),
    isCinematic: vi.fn(() => owner === "shadow"),
    isAvailable: vi.fn(() => false),
    complete: false,
  };
  const director = {
    update: vi.fn(),
    story: { current: vi.fn(() => "reach-door") },
  };
  const player = {
    setControllerInput: vi.fn(),
    update: vi.fn(),
    syncAfterPhysics: vi.fn(),
    body: { translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })) },
    velocity: { x: 0, z: 0 },
    cameraYaw: 0,
    cameraPitch: 0,
    selected: null,
  };
  const renderer = { render: vi.fn(), domElement: { dataset: {} } };
  const experience = {
    world: { timestep: 0, step: vi.fn() },
    update: vi.fn(),
    renderer,
    scene: {},
    camera: {},
  };
  const app = Object.assign(Object.create(DesktopApp.prototype), {
    paused: false,
    elapsed: 0,
    lastFrame: 0,
    debugFrames: 0,
    debugShadowAutoplay: false,
    debugShadowTriggered: false,
    lastFeedbackSequence: -1,
    phone: {
      connected: true,
      currentInput: vi.fn(() => ({
        seq: -1,
        move: { x: 0, y: 0 },
        viewDelta: { yaw: 0, pitch: 0 },
        clutch: false,
      })),
      send: vi.fn(),
    },
    player,
    experience,
    shadowQuest,
    foundPhone,
    doorDefense,
    director,
    audio: { update: vi.fn() },
    npcRuntime: { update: vi.fn() },
    rightHandFlashlight: { update: vi.fn(), destroy: vi.fn() },
    sampleDebugPixels: vi.fn(),
  });
  return { app, doorDefense, foundPhone, shadowQuest, director };
}

function createAudioContextHarness() {
  const oscillators = [];
  const sources = [];
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = () => ({ connect(target) { return target; } });
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 80;
      this.destination = node();
    }

    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }

    createBufferSource() {
      const source = { ...node(), start: vi.fn(), stop: vi.fn(), loop: false, buffer: null };
      sources.push(source);
      return source;
    }

    createBiquadFilter() {
      return { ...node(), frequency: parameter(), Q: parameter(), type: "" };
    }

    createGain() {
      return { ...node(), gain: parameter() };
    }

    createOscillator() {
      const oscillator = {
        ...node(),
        frequency: parameter(),
        start: vi.fn(),
        stop: vi.fn(),
        type: "",
      };
      oscillators.push(oscillator);
      return oscillator;
    }

    close() {}
  }
  return { AudioContext, oscillators, sources };
}

afterEach(() => {
  createSceneMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("desktop control feedback", () => {
  it("shows recording only for active voice actions", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      ui: { setVoiceRecording: vi.fn() },
      npcRuntime: { beginCapture: vi.fn() },
    });

    app.handlePhoneAction({ action: "voice-recording", active: true });
    app.handlePhoneAction({ action: "voice-recording", active: false });

    expect(app.ui.setVoiceRecording.mock.calls).toEqual([[true], [false]]);
    expect(app.npcRuntime.beginCapture).toHaveBeenCalledOnce();
  });

  it("forwards phone clips, PCM frames, and browser transcripts to the NPC runtime", async () => {
    const npcRuntime = {
      acceptVoiceClip: vi.fn(async () => true),
      acceptVoiceFrame: vi.fn(() => true),
      acceptTranscript: vi.fn(async () => true),
    };
    const app = Object.assign(Object.create(DesktopApp.prototype), { destroyed: false, npcRuntime });
    const clip = { data: new ArrayBuffer(8), mimeType: "audio/webm" };
    const frame = new ArrayBuffer(16);
    const transcript = { transcript: "Mara", confidence: 0.9, voiceLevel: 0.5 };

    await app.handlePhoneVoiceClip({ detail: clip });
    app.handlePhoneVoiceStream({ detail: frame });
    await app.handlePhoneAction({ action: "voice-transcript", ...transcript });

    expect(npcRuntime.acceptVoiceClip).toHaveBeenCalledWith(clip);
    expect(npcRuntime.acceptVoiceFrame).toHaveBeenCalledWith(frame);
    expect(npcRuntime.acceptTranscript).toHaveBeenCalledWith(transcript);
  });

  it("shows a phone transcript even when the NPC runtime is unavailable", async () => {
    const ui = { setPlayerTranscript: vi.fn() };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      npcRuntime: null,
      ui,
    });

    await app.handlePhoneAction({
      action: "voice-transcript",
      transcript: "我在门外",
      confidence: 0.91,
      voiceLevel: 0.55,
    });

    expect(ui.setPlayerTranscript).toHaveBeenCalledWith("我在门外", true);
  });

  it("transcribes a phone audio clip and shows a subtitle when NPC capture is unavailable", async () => {
    const ui = { setPlayerTranscript: vi.fn() };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transcript: "我在门外", confidence: 0.92, voiceLevel: 0.61 }),
    }));
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      npcRuntime: null,
      ui,
      fetchImpl,
    });

    const accepted = await app.handlePhoneVoiceClip({
      detail: { mimeType: "audio/webm", data: new ArrayBuffer(8) },
    });

    expect(accepted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/npc/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: expect.any(ArrayBuffer),
    });
    expect(ui.setPlayerTranscript).toHaveBeenCalledWith("我在门外", true);
  });


  it("reveals the PPT paper only for a PPT voice keyword at the story door", () => {
    const presentation = {
      isOpen: vi.fn(() => false),
      showPaper: vi.fn(() => true),
    };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      currentTargetId: "knock-door",
      presentation,
      ui: { setPlayerTranscript: vi.fn(), setPrompt: vi.fn() },
    });

    expect(app.tryPresentationVoiceTrigger("PPT")).toBe(true);
    expect(presentation.showPaper).toHaveBeenCalledOnce();
    expect(app.tryPresentationVoiceTrigger("hello")).toBe(false);
  });

  it("opens the deck when the tracked hand grabs the visible paper", () => {
    const presentation = { open: vi.fn(() => true) };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      paused: false,
      inventoryOpen: false,
      currentTargetId: "presentation-paper",
      currentTargetEpoch: 4,
      presentation,
      doorDefense: null,
      knockDoor: null,
      foundPhone: null,
      shadowQuest: null,
    });

    expect(app.handleHandGesture({ type: "grab", targetId: "presentation-paper", targetEpoch: 4 })).toBe(true);
    expect(presentation.open).toHaveBeenCalledWith({ source: "door" });
  });

  it("reports each applied input sequence and resulting camera angles once", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      lastFeedbackSequence: -1,
      phone: { send: vi.fn() },
      player: { cameraYaw: Math.PI / 2, cameraPitch: -Math.PI / 12 },
    });

    app.sendControlFeedback({ seq: 4 });
    app.sendControlFeedback({ seq: 4 });

    expect(app.phone.send).toHaveBeenCalledTimes(1);
    expect(app.phone.send).toHaveBeenCalledWith({
      type: "control-feedback",
      seq: 4,
      cameraYaw: 90,
      cameraPitch: -15,
    });
  });

  it("forwards focused interaction targets to the phone and reticle", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      currentTargetId: null,
      phone: { send: vi.fn() },
      ui: { setTargetFocused: vi.fn() },
      handTracking: { setTarget: vi.fn() },
    });

    app.handleTargetFocus({
      id: "fuse",
      focused: true,
      contactPoint: { x: 0.1, y: 0.2, z: -0.9 },
      contactNormal: { x: 0, y: 0, z: 1 },
      focusedAt: 12,
    });
    app.handleTargetFocus({ id: null, focused: false, focusedAt: 30 });

    expect(app.phone.send).toHaveBeenNthCalledWith(1, { type: "target-focus", id: "fuse" });
    expect(app.phone.send).toHaveBeenNthCalledWith(2, { type: "target-focus", id: null });
    expect(app.ui.setTargetFocused).toHaveBeenNthCalledWith(1, true);
    expect(app.ui.setTargetFocused).toHaveBeenNthCalledWith(2, false);
    expect(app.handTracking.setTarget).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: "fuse",
      contactPoint: { x: 0.1, y: 0.2, z: -0.9 },
    }));
    expect(app.handTracking.setTarget).toHaveBeenNthCalledWith(2, null);
  });
});

describe("desktop inventory routing", () => {
  function createInventoryApp(overrides = {}) {
    const inventory = new InventoryState([{ id: "spare-fuse", enabled: true }]);
    inventory.acquire("spare-fuse");
    const ui = {
      setInventory: vi.fn(),
      moveInventoryCursor: vi.fn(() => "spare-fuse"),
      inventoryItemAtCursor: vi.fn(() => "spare-fuse"),
      closeInventory: vi.fn(),
      setVoiceRecording: vi.fn(),
    };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      destroyed: false,
      started: true,
      paused: false,
      inventoryOpen: false,
      inventory,
      ui,
      player: {},
      doorDefense: { isCinematic: vi.fn(() => false) },
      foundPhone: { isInspecting: vi.fn(() => false) },
      shadowQuest: { isCinematic: vi.fn(() => false) },
      handTracking: {
        owner: null,
        hand: { setHeldItem: vi.fn() },
        presentEquippedItem: vi.fn(),
      },
      experience: { objects: { heldFuse: { id: "held-fuse" } } },
    }, overrides);
    return { app, inventory, ui };
  }

  it("opens, moves the desktop cursor, equips the hovered enabled item, and closes", () => {
    const { app, inventory, ui } = createInventoryApp();

    expect(app.handlePhoneAction({ action: "inventory-pointer", phase: "open", entryY: 0.25 })).toBe(true);
    expect(app.handlePhoneAction({ action: "inventory-pointer", phase: "move", dx: 12, dy: -4 })).toBe(true);
    expect(app.handlePhoneAction({ action: "inventory-pointer", phase: "commit" })).toBe(true);

    expect(ui.setInventory).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ id: "spare-fuse", enabled: true }] }),
      { entryEdge: "right", entryY: 0.25 }
    );
    expect(ui.moveInventoryCursor).toHaveBeenCalledWith(12, -4);
    expect(inventory.snapshot().equippedId).toBe("spare-fuse");
    expect(inventory.snapshot().hoveredId).toBeNull();
    expect(ui.closeInventory).toHaveBeenCalledOnce();
    expect(app.inventoryOpen).toBe(false);
    expect(app.handTracking.presentEquippedItem).toHaveBeenCalledOnce();
  });

  it("routes tracked-hand swipe events through the inventory and presents the selected item", () => {
    const { app, inventory, ui } = createInventoryApp();

    expect(app.handleTrackedInventoryGesture({ type: "open", entryY: 0.4 })).toBe(true);
    expect(app.handleTrackedInventoryGesture({ type: "move", dx: -28, dy: 4 })).toBe(true);
    expect(app.handleTrackedInventoryGesture({ type: "commit", id: "spare-fuse" })).toBe(true);

    expect(inventory.snapshot().equippedId).toBe("spare-fuse");
    expect(app.handTracking.presentEquippedItem).toHaveBeenCalledOnce();
    expect(ui.closeInventory).toHaveBeenCalledOnce();
  });

  it("preserves equipment on empty release and cancellation", () => {
    const { app, inventory, ui } = createInventoryApp();
    inventory.equip("spare-fuse");
    ui.inventoryItemAtCursor.mockReturnValue(null);

    app.handlePhoneAction({ action: "inventory-pointer", phase: "open" });
    app.handlePhoneAction({ action: "inventory-pointer", phase: "commit" });
    expect(inventory.snapshot().equippedId).toBe("spare-fuse");

    app.handlePhoneAction({ action: "inventory-pointer", phase: "open" });
    app.handlePhoneAction({ action: "inventory-pointer", phase: "cancel" });
    expect(inventory.snapshot().equippedId).toBe("spare-fuse");
    expect(ui.closeInventory).toHaveBeenCalledTimes(2);
  });

  it("clears transient presentation without dropping acquired or equipped ownership", () => {
    const { app, inventory, ui } = createInventoryApp();
    inventory.equip("spare-fuse");
    inventory.setHovered("spare-fuse");
    app.inventoryOpen = true;
    app.fallbackHolding = true;
    app.fallbackKeyDown = true;
    app.player = { resetCrouch: vi.fn() };
    app.handTracking = { suppressEquipment: vi.fn() };
    app.releaseFallbackHold = vi.fn(() => {
      app.fallbackHolding = false;
      app.fallbackKeyDown = false;
    });

    app.clearTransientInteractionState("test");

    expect(ui.setVoiceRecording).toHaveBeenCalledExactlyOnceWith(false);
    expect(ui.closeInventory).toHaveBeenCalledOnce();
    expect(app.player.resetCrouch).toHaveBeenCalledOnce();
    expect(app.handTracking.suppressEquipment).toHaveBeenCalledOnce();
    expect(app.releaseFallbackHold).toHaveBeenCalledOnce();
    expect(inventory.snapshot()).toMatchObject({
      items: [{ id: "spare-fuse", enabled: true }],
      equippedId: "spare-fuse",
      hoveredId: null,
    });
  });

  it("neutralizes stale RTC gameplay input while the ordered inventory modal is open", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 12));
    const { app } = createTickHarness();
    const staleInput = {
      seq: 7,
      move: { x: 0.8, y: -0.5 },
      viewDelta: { yaw: 14, pitch: -9 },
      clutch: true,
      crouch: true,
    };
    app.phone.currentInput.mockReturnValue(staleInput);
    app.inventoryOpen = true;

    app.tick(16);

    expect(app.phone.currentInput).toHaveBeenCalledOnce();
    expect(app.player.setControllerInput).toHaveBeenCalledWith({
      ...staleInput,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: false,
    }, true);
  });

  it.each([
    ["before gameplay", { started: false }],
    ["while paused", { paused: true }],
    ["in fallback keyboard mode", { fallback: true }],
    ["during door cinematic", { doorDefense: { isCinematic: () => true } }],
    ["during found-phone cinematic", { foundPhone: { isInspecting: () => true } }],
    ["during shadow cinematic", { shadowQuest: { isCinematic: () => true } }],
    ["during semantic hand task", { handTracking: { owner: "door-defense" } }],
  ])("rejects opening %s", (_label, override) => {
    const { app, ui } = createInventoryApp(override);

    expect(app.handlePhoneAction({ action: "inventory-pointer", phase: "open" })).toBe(false);
    expect(app.inventoryOpen).toBe(false);
    expect(ui.setInventory).not.toHaveBeenCalled();
  });
});

describe("desktop director routing", () => {
  it("rejects hand grab with stale target epoch", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      currentTargetId: null,
      currentTargetEpoch: 0,
      player: { interact: vi.fn() },
      doorDefense: { isCinematic: vi.fn(() => false) },
      foundPhone: { isInspecting: vi.fn(() => false) },
      shadowQuest: { isCinematic: vi.fn(() => false) },
    });

    app.handleTargetFocus({ id: "fuse", focused: true, epoch: 12, contactPoint: { x: 0, y: 1, z: -1 }, contactNormal: { x: 0, y: 0, z: 1 }, focusedAt: 40 });

    expect(app.handleHandGesture({ type: "grab", targetId: "fuse", targetEpoch: 11 })).toBe(false);
    expect(app.player.interact).not.toHaveBeenCalled();
  });

  it("applies a confirmed hand grab only to the currently focused target", () => {
    const player = { interact: vi.fn() };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      player,
      currentTargetId: "washbasin",
      currentTargetEpoch: 7,
      doorDefense: { isCinematic: vi.fn(() => false) },
      foundPhone: { isInspecting: vi.fn(() => false) },
      shadowQuest: { isCinematic: vi.fn(() => false) },
    });

    expect(app.handleHandGesture({ type: "grab", targetId: "washbasin", targetEpoch: 7 })).toBe(true);
    expect(player.interact).toHaveBeenCalledExactlyOnceWith("hand");

    app.currentTargetId = null;
    expect(app.handleHandGesture({ type: "grab", targetId: "washbasin", targetEpoch: 7 })).toBe(false);
    expect(player.interact).toHaveBeenCalledOnce();
  });

  it("suppresses ordinary grab pulses while a cinematic owns input", () => {
    const player = { interact: vi.fn() };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      player,
      currentTargetId: "found-phone",
      doorDefense: { isCinematic: vi.fn(() => true) },
      foundPhone: { isInspecting: vi.fn(() => false) },
      shadowQuest: { isCinematic: vi.fn(() => false) },
    });

    expect(app.handleHandGesture({ type: "grab" })).toBe(false);
    expect(player.interact).not.toHaveBeenCalled();
  });

  it("discards obsolete camera-pixel presence actions before they reach gameplay", () => {
    const foundPhone = { handlePresence: vi.fn() };
    const doorDefense = { handlePresence: vi.fn() };
    const app = Object.assign(Object.create(DesktopApp.prototype), { foundPhone, doorDefense });
    const phonePayload = {
      action: "gesture-presence",
      context: "found-phone",
      ready: true,
      active: false,
      sentAt: 123,
    };
    const doorPayload = {
      action: "gesture-presence",
      context: "door-defense",
      ready: true,
      active: true,
      sentAt: 456,
    };

    app.handlePhoneAction(phonePayload);
    app.handlePhoneAction(doorPayload);
    expect(doorDefense.handlePresence).not.toHaveBeenCalled();
    expect(foundPhone.handlePresence).not.toHaveBeenCalled();
  });

  it("routes explicit fallback hold only to the door task", () => {
    const setFallbackHolding = vi.fn(() => true);
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      doorDefense: { setFallbackHolding },
    });

    app.handlePhoneAction({ action: "task-hold", context: "door-defense", active: true });
    app.handlePhoneAction({ action: "task-hold", context: "found-phone", active: true });

    expect(setFallbackHolding).toHaveBeenCalledExactlyOnceWith(true, { explicit: true });
  });

  it("produces and closes the controller found-phone UI through held hand-task state", () => {
    const phone = { send: vi.fn() };
    const player = { beginCinematic: vi.fn(), endCinematic: vi.fn() };
    let handState = { phase: "tracking", fresh: true };
    const handTracking = {
      beginTask: vi.fn(() => true),
      snapshot: vi.fn(() => handState),
      endTask: vi.fn(),
    };
    const foundPhone = new FoundPhoneDirector({
      experience: { objects: { foundPhone: { enabled: true, setHeld: vi.fn() } } },
      player,
      audio: { cue: vi.fn() },
      sendControllerEvent: (event) => phone.send(event),
      handTracking,
    });
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      phone,
      foundPhone,
      doorDefense: { isCinematic: vi.fn(() => false), handlePresence: vi.fn() },
      shadowQuest: { isCinematic: vi.fn(() => false), handleInteraction: vi.fn(() => false) },
      director: { handleInteraction: vi.fn(() => false) },
    });

    expect(app.handleInteraction("found-phone", { source: "hand" })).toBe(true);
    expect(phone.send).not.toHaveBeenCalledWith({ type: "found-phone-ui", active: true });
    handState = { phase: "held", fresh: true };
    foundPhone.update(0.016);
    expect(phone.send).toHaveBeenCalledWith({ type: "found-phone-ui", active: true });

    handState = { phase: "success", fresh: true };
    foundPhone.update(0.016);
    expect(phone.send).toHaveBeenCalledWith({ type: "found-phone-ui", active: false });
    expect(player.endCinematic).toHaveBeenCalledOnce();
  });

  it("tries found phone, shadow quest, and normal horror interactions in priority order", () => {
    const order = [];
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      foundPhone: {
        isInspecting: vi.fn(() => false),
        handleInteraction: vi.fn(() => { order.push("phone"); return false; }),
      },
      doorDefense: { isCinematic: vi.fn(() => false) },
      shadowQuest: {
        isCinematic: vi.fn(() => false),
        handleInteraction: vi.fn(() => { order.push("shadow"); return false; }),
      },
      director: { handleInteraction: vi.fn(() => { order.push("horror"); return true; }) },
    });

    const interactionDetails = { source: "touch" };
    expect(app.handleInteraction("washbasin", interactionDetails)).toBe(true);
    expect(order).toEqual(["phone", "shadow", "horror"]);
    expect(app.director.handleInteraction).toHaveBeenCalledWith("washbasin", interactionDetails);

    order.length = 0;
    app.foundPhone.handleInteraction.mockImplementationOnce(() => { order.push("phone"); return true; });
    expect(app.handleInteraction("found-phone")).toBe(true);
    expect(order).toEqual(["phone"]);
  });

  it("permits equipment only during unobstructed tracked-hand gameplay", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      started: true,
      fallback: false,
      paused: false,
      destroyed: false,
      inventoryOpen: false,
      doorDefense: { isCinematic: () => false },
      foundPhone: { isInspecting: () => false },
      shadowQuest: { isCinematic: () => false },
    });
    expect(app.canPresentEquipment()).toBe(true);
    app.inventoryOpen = true;
    expect(app.canPresentEquipment()).toBe(false);
    app.inventoryOpen = false;
    app.doorDefense.isCinematic = () => true;
    expect(app.canPresentEquipment()).toBe(false);
  });

  it.each(["door", "phone", "shadow"])("suppresses normal horror ticks while %s owns the cinematic", (owner) => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 9));
    const { app, doorDefense, shadowQuest, director } = createTickHarness({ owner });

    app.tick(16);

    expect(doorDefense.update).toHaveBeenCalledExactlyOnceWith(0.016);
    expect(shadowQuest.update).toHaveBeenCalledExactlyOnceWith(0.016, 0.016);
    expect(director.update).not.toHaveBeenCalled();
  });

  it("ticks normal horror only when no cinematic director owns the camera", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 10));
    const { app, director } = createTickHarness();

    app.tick(16);

    expect(director.update).toHaveBeenCalledExactlyOnceWith(0.016, 0.016);
  });

  it("ticks found-phone recovery while the phone owns the cinematic", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 11));
    const { app, foundPhone } = createTickHarness({ owner: "phone" });

    app.tick(16);

    expect(foundPhone.update).toHaveBeenCalledExactlyOnceWith(0.016);
  });

  it("defers proximity door acquisition while inventory owns input and resumes after close", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 13));
    const { app, doorDefense } = createTickHarness();
    doorDefense.acquire = vi.fn();
    doorDefense.update.mockImplementation(() => doorDefense.acquire());
    app.inventoryOpen = true;
    app.inventory = { setHovered: vi.fn() };
    app.ui = { closeInventory: vi.fn() };

    app.tick(16);

    expect(doorDefense.update).not.toHaveBeenCalled();
    expect(doorDefense.acquire).not.toHaveBeenCalled();

    expect(app.closeInventory()).toBe(true);
    app.tick(32);

    expect(doorDefense.update).toHaveBeenCalledExactlyOnceWith(0.016);
    expect(doorDefense.acquire).toHaveBeenCalledOnce();
  });

  it("clears transient presentation when proximity starts the door cinematic", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 14));
    const { app, doorDefense } = createTickHarness();
    let cinematic = false;
    doorDefense.isCinematic.mockImplementation(() => cinematic);
    doorDefense.update.mockImplementation(() => { cinematic = true; });
    app.clearTransientInteractionState = vi.fn();

    app.tick(16);

    expect(app.clearTransientInteractionState).toHaveBeenCalledExactlyOnceWith("cinematic:door-defense");
  });

  it("forwards a normalized crouch input to the player", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 14));
    const { app } = createTickHarness();
    app.phone.currentInput.mockReturnValue({
      seq: 1,
      move: { x: 0, y: 0 },
      viewDelta: { yaw: 0, pitch: 0 },
      clutch: false,
      crouch: undefined,
    });

    app.tick(16);

    expect(app.player.setControllerInput).toHaveBeenCalledWith(expect.objectContaining({ crouch: false }), true);
  });

  it("aborts both new scenes and the shadow quest on peer disconnect", () => {
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      started: true,
      fallback: false,
      fallbackHolding: false,
      ui: { setConnected: vi.fn(), setVoiceRecording: vi.fn(), showPause: vi.fn(), showPairing: vi.fn() },
      foundPhone: { release: vi.fn() },
      doorDefense: { abort: vi.fn(), setFallbackHolding: vi.fn() },
      shadowQuest: { abort: vi.fn() },
      player: { setPaused: vi.fn() },
    });

    app.handlePeer(false);

    expect(app.foundPhone.release).toHaveBeenCalledOnce();
    expect(app.doorDefense.abort).toHaveBeenCalledOnce();
    expect(app.shadowQuest.abort).toHaveBeenCalledOnce();
    expect(app.player.setPaused).toHaveBeenCalledWith(true);
    expect(app.ui.setVoiceRecording).toHaveBeenCalledWith(false);
  });

  it("finishes disconnect cleanup when an earlier release throws", () => {
    const firstError = new Error("fallback release failed");
    const order = [];
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      started: true,
      fallback: false,
      ui: {
        setConnected: vi.fn(() => order.push("connection")),
        showPause: vi.fn(() => order.push("pause-ui")),
        showPairing: vi.fn(() => order.push("pairing")),
      },
      releaseFallbackHold: vi.fn(() => { order.push("hold"); throw firstError; }),
      foundPhone: { release: vi.fn(() => order.push("phone")) },
      doorDefense: { abort: vi.fn(() => order.push("door")) },
      shadowQuest: { abort: vi.fn(() => order.push("shadow")) },
      player: { setPaused: vi.fn(() => order.push("player")) },
    });

    expect(() => app.handlePeer(false)).toThrow(firstError);

    expect(app.paused).toBe(true);
    expect(order).toEqual(["connection", "hold", "phone", "door", "shadow", "player", "pause-ui", "pairing"]);
  });
});

describe("fallback Space hold", () => {
  it("presses once, ignores repeat, and releases only in fallback mode", () => {
    const doorDefense = { setFallbackHolding: vi.fn(() => true) };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      fallback: true,
      fallbackHolding: false,
      paused: false,
      destroyed: false,
      doorDefense,
    });
    const event = { code: "Space", repeat: false, preventDefault: vi.fn() };

    app.handleFallbackKeyDown(event);
    app.handleFallbackKeyDown({ ...event, repeat: true });
    app.handleFallbackKeyDown(event);
    app.handleFallbackKeyUp(event);

    expect(doorDefense.setFallbackHolding.mock.calls).toEqual([[true], [false]]);

    app.fallback = false;
    app.handleFallbackKeyDown(event);
    app.handleFallbackKeyUp(event);
    expect(doorDefense.setFallbackHolding.mock.calls).toEqual([[true], [false]]);
  });

  it("does not latch a Space press rejected before the director is ready", () => {
    const doorDefense = { setFallbackHolding: vi.fn(() => false) };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      fallback: true,
      fallbackHolding: false,
      paused: false,
      destroyed: false,
      doorDefense,
    });

    app.handleFallbackKeyDown({ code: "Space", repeat: false, preventDefault: vi.fn() });

    expect(doorDefense.setFallbackHolding).toHaveBeenCalledExactlyOnceWith(true);
    expect(app.fallbackHolding).toBe(false);
  });

  it("releases an active hold on blur and pause", () => {
    vi.stubGlobal("document", { pointerLockElement: null });
    const doorDefense = { setFallbackHolding: vi.fn() };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      fallback: true,
      fallbackHolding: true,
      paused: false,
      destroyed: false,
      doorDefense,
      player: { setPaused: vi.fn() },
      audio: { setPaused: vi.fn() },
      ui: { showPause: vi.fn(), setVoiceRecording: vi.fn() },
    });

    app.handleWindowBlur();
    expect(doorDefense.setFallbackHolding).toHaveBeenLastCalledWith(false);

    app.fallbackHolding = true;
    app.setPaused(true);
    expect(doorDefense.setFallbackHolding).toHaveBeenLastCalledWith(false);
    expect(doorDefense.setFallbackHolding).toHaveBeenCalledTimes(2);
    expect(app.ui.setVoiceRecording).toHaveBeenCalledWith(false);
  });

  it("aborts every cinematic interaction before pausing the player", () => {
    vi.stubGlobal("document", { pointerLockElement: null });
    const order = [];
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      paused: false,
      fallbackHolding: false,
      fallbackKeyDown: false,
      foundPhone: { release: vi.fn(() => order.push("phone")) },
      doorDefense: { abort: vi.fn(() => order.push("door")) },
      shadowQuest: { abort: vi.fn(() => order.push("shadow")) },
      player: { setPaused: vi.fn(() => order.push("player")) },
      audio: { setPaused: vi.fn(() => order.push("audio")) },
      ui: { showPause: vi.fn(() => order.push("ui")) },
    });

    app.setPaused(true);

    expect(order).toEqual(["phone", "door", "shadow", "player", "audio", "ui"]);
  });

  it("still pauses every subsystem when an earlier pause cleanup throws", () => {
    vi.stubGlobal("document", { pointerLockElement: null });
    const firstError = new Error("hold release failed");
    const order = [];
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      paused: false,
      releaseFallbackHold: vi.fn(() => { order.push("hold"); throw firstError; }),
      foundPhone: { release: vi.fn(() => order.push("phone")) },
      doorDefense: { abort: vi.fn(() => order.push("door")) },
      shadowQuest: { abort: vi.fn(() => order.push("shadow")) },
      player: { setPaused: vi.fn(() => order.push("player")) },
      audio: { setPaused: vi.fn(() => order.push("audio")) },
      ui: { showPause: vi.fn(() => order.push("ui")) },
    });

    expect(() => app.setPaused(true)).toThrow(firstError);

    expect(app.paused).toBe(true);
    expect(order).toEqual(["hold", "phone", "door", "shadow", "player", "audio", "ui"]);
  });

  it("forwards keyup after a rejected retry hold so the director can rearm", () => {
    const doorDefense = { setFallbackHolding: vi.fn(() => false) };
    const app = Object.assign(Object.create(DesktopApp.prototype), {
      fallback: true,
      fallbackHolding: false,
      fallbackKeyDown: false,
      paused: false,
      destroyed: false,
      doorDefense,
    });
    const event = { code: "Space", repeat: false, preventDefault: vi.fn() };

    app.handleFallbackKeyDown(event);
    app.handleFallbackKeyUp(event);

    expect(doorDefense.setFallbackHolding.mock.calls).toEqual([[true], [false]]);
    expect(app.fallbackKeyDown).toBe(false);
  });

  it("registers stored handlers and destroys directors before player and scene exactly once", () => {
    const fakeWindow = createEventTarget();
    fakeWindow.matchMedia = vi.fn(() => ({ matches: false }));
    const fakeDocument = createEventTarget();
    const { root } = createRoot();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "", reload: vi.fn() });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const app = new DesktopApp(root);
    app.mount();
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith("keydown", app.handleFallbackKeyDown);
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith("keyup", app.handleFallbackKeyUp);
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith("blur", app.handleWindowBlur);

    const order = [];
    app.fallback = true;
    app.fallbackHolding = true;
    app.foundPhone = { destroy: vi.fn(() => order.push("phone")) };
    app.doorDefense = {
      setFallbackHolding: vi.fn(() => order.push("hold")),
      destroy: vi.fn(() => order.push("door")),
    };
    app.shadowQuest = { destroy: vi.fn(() => order.push("shadow")) };
    app.player = { destroy: vi.fn(() => order.push("player")) };
    app.experience = { dispose: vi.fn(() => order.push("scene")) };
    app.audio = { dispose: vi.fn(() => order.push("audio")) };
    app.phone = {
      removeEventListener: vi.fn(),
      destroy: vi.fn(() => order.push("session")),
    };

    app.destroy();
    app.destroy();

    expect(order).toEqual(["hold", "phone", "door", "shadow", "player", "scene", "audio", "session"]);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("keydown", app.handleFallbackKeyDown);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("keyup", app.handleFallbackKeyUp);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("blur", app.handleWindowBlur);
  });

  it("detaches phone events before disconnect and ignores synchronous or delayed teardown dispatches", async () => {
    const fakeWindow = createEventTarget();
    fakeWindow.matchMedia = vi.fn(() => ({ matches: false }));
    const fakeDocument = createEventTarget();
    const { root } = createRoot();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const app = new DesktopApp(root);
    app.mount();
    const phone = app.phone;
    const removePhoneListener = vi.spyOn(phone, "removeEventListener");
    const delayedRoom = app.handlePhoneRoom;
    const delayedPeer = app.handlePhonePeer;
    const delayedAction = app.handlePhoneActionEvent;
    const dispatch = (type, detail) => {
      const event = new Event(type);
      Object.defineProperty(event, "detail", { value: detail });
      phone.dispatchEvent(event);
    };

    app.started = true;
    app.ui.setRoom = vi.fn();
    app.ui.setConnected = vi.fn();
    app.ui.showPause = vi.fn();
    app.ui.showPairing = vi.fn();
    const playerInteract = vi.fn();
    const foundPresence = vi.fn();
    const doorPresence = vi.fn();
    const phoneSend = vi.spyOn(phone, "send");
    app.player = { interact: playerInteract, setPaused: vi.fn(), destroy: vi.fn() };
    app.foundPhone = {
      handlePresence: foundPresence,
      release: vi.fn(),
      destroy: vi.fn(() => app.phone?.send({ type: "cleanup" })),
    };
    app.doorDefense = { handlePresence: doorPresence, abort: vi.fn(), destroy: vi.fn() };
    app.shadowQuest = { abort: vi.fn(), destroy: vi.fn() };
    app.audio = { dispose: vi.fn(), setPaused: vi.fn() };
    phone.destroy = vi.fn(() => {
      dispatch("peer", { connected: false });
      dispatch("action", { action: "pause" });
      dispatch("action", {
        action: "gesture-presence",
        context: "found-phone",
        ready: true,
        active: false,
      });
      dispatch("room", { code: "617617" });
    });

    app.destroy();
    app.destroy();
    dispatch("peer", { connected: false });
    dispatch("action", { action: "interact" });
    dispatch("action", {
      action: "gesture-presence",
      context: "door-defense",
      ready: true,
      active: true,
    });
    dispatch("room", { code: "late" });
    await Promise.resolve();
    delayedPeer({ detail: { connected: false } });
    delayedAction({ detail: { action: "pause" } });
    delayedRoom({ detail: { code: "microtask" } });

    expect(removePhoneListener).toHaveBeenCalledWith("room", app.handlePhoneRoom);
    expect(removePhoneListener).toHaveBeenCalledWith("peer", app.handlePhonePeer);
    expect(removePhoneListener).toHaveBeenCalledWith("action", app.handlePhoneActionEvent);
    expect(phone.destroy).toHaveBeenCalledOnce();
    expect(phoneSend).toHaveBeenCalledExactlyOnceWith({ type: "cleanup" });
    expect(removePhoneListener.mock.invocationCallOrder[0]).toBeLessThan(phoneSend.mock.invocationCallOrder[0]);
    expect(phoneSend.mock.invocationCallOrder[0]).toBeLessThan(phone.destroy.mock.invocationCallOrder[0]);
    expect(app.phone).toBeNull();
    expect(app.ui.setRoom).not.toHaveBeenCalled();
    expect(app.ui.setConnected).not.toHaveBeenCalled();
    expect(app.ui.showPause).not.toHaveBeenCalled();
    expect(app.ui.showPairing).not.toHaveBeenCalled();
    expect(app.audio.setPaused).not.toHaveBeenCalled();
    expect(playerInteract).not.toHaveBeenCalled();
    expect(foundPresence).not.toHaveBeenCalled();
    expect(doorPresence).not.toHaveBeenCalled();
  });

  it("still destroys and releases the phone when earlier teardown throws", () => {
    const fakeWindow = createEventTarget();
    const fakeDocument = createEventTarget();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const app = new DesktopApp({});
    const phone = { removeEventListener: vi.fn(), destroy: vi.fn() };
    app.phone = phone;
    app.ui = { elements: {} };
    app.foundPhone = { destroy: vi.fn(() => { throw new Error("runtime teardown failed"); }) };
    const doorDefense = { destroy: vi.fn() };
    const shadowQuest = { destroy: vi.fn() };
    const director = { destroy: vi.fn() };
    const player = { destroy: vi.fn() };
    const experience = { dispose: vi.fn() };
    app.doorDefense = doorDefense;
    app.shadowQuest = shadowQuest;
    app.director = director;
    app.player = player;
    app.experience = experience;
    app.audio = { dispose: vi.fn() };

    expect(() => app.destroy()).toThrow("runtime teardown failed");
    expect(() => app.destroy()).not.toThrow();

    expect(app.doorDefense).toBeNull();
    expect(app.shadowQuest).toBeNull();
    expect(app.player).toBeNull();
    expect(app.experience).toBeNull();
    expect(doorDefense.destroy).toHaveBeenCalledOnce();
    expect(shadowQuest.destroy).toHaveBeenCalledOnce();
    expect(director.destroy).toHaveBeenCalledOnce();
    expect(player.destroy).toHaveBeenCalledOnce();
    expect(experience.dispose).toHaveBeenCalledOnce();
    expect(app.audio.dispose).toHaveBeenCalledOnce();
    expect(phone.destroy).toHaveBeenCalledOnce();
    expect(app.phone).toBeNull();
  });

  it("continues teardown when releasing fallback hold throws", () => {
    const fakeWindow = createEventTarget();
    const fakeDocument = createEventTarget();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const order = [];
    const releaseError = new Error("fallback release failed");
    const app = new DesktopApp({});
    const phone = {
      removeEventListener: vi.fn(),
      destroy: vi.fn(() => order.push("session")),
    };
    app.phone = phone;
    app.ui = { elements: {} };
    app.fallbackHolding = true;
    app.foundPhone = { destroy: vi.fn(() => order.push("phone")) };
    app.doorDefense = {
      setFallbackHolding: vi.fn(() => {
        order.push("hold");
        throw releaseError;
      }),
      destroy: vi.fn(() => order.push("door")),
    };
    app.shadowQuest = { destroy: vi.fn(() => order.push("shadow")) };
    app.player = { destroy: vi.fn(() => order.push("player")) };
    app.experience = { dispose: vi.fn(() => order.push("scene")) };
    app.audio = { dispose: vi.fn(() => order.push("audio")) };

    expect(() => app.destroy()).toThrow(releaseError);
    expect(() => app.destroy()).not.toThrow();

    expect(order).toEqual(["hold", "phone", "door", "shadow", "player", "scene", "audio", "session"]);
    expect(phone.removeEventListener).toHaveBeenCalledWith("room", app.handlePhoneRoom);
    expect(phone.removeEventListener).toHaveBeenCalledWith("peer", app.handlePhonePeer);
    expect(phone.removeEventListener).toHaveBeenCalledWith("action", app.handlePhoneActionEvent);
    expect(fakeDocument.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      app.handleVisibilityChange,
    );
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("keydown", app.handleFallbackKeyDown);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("keyup", app.handleFallbackKeyUp);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("blur", app.handleWindowBlur);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("pagehide", app.handlePageHide);
    expect(app.fallbackHolding).toBe(false);
    expect(app.foundPhone).toBeNull();
    expect(app.doorDefense).toBeNull();
    expect(app.shadowQuest).toBeNull();
    expect(app.player).toBeNull();
    expect(app.experience).toBeNull();
    expect(app.audio.dispose).toHaveBeenCalledOnce();
    expect(phone.destroy).toHaveBeenCalledOnce();
    expect(app.phone).toBeNull();
  });

  it("disposes a scene that resolves after destroy without resuming startup", async () => {
    const fakeWindow = createEventTarget();
    fakeWindow.matchMedia = vi.fn(() => ({ matches: false }));
    const fakeDocument = createEventTarget();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});

    let resolveScene;
    createSceneMock.mockReturnValue(new Promise((resolve) => { resolveScene = resolve; }));
    const scene = { dispose: vi.fn() };
    const app = new DesktopApp({});
    app.ui = {
      elements: {
        sceneHost: {},
        pairingStatus: { innerHTML: "" },
        startButton: createElement(),
        fallbackButton: createElement(),
      },
      showLoading: vi.fn(),
      showPairing: vi.fn(),
    };
    app.audio = { start: vi.fn(), dispose: vi.fn() };
    app.phone = { destroy: vi.fn() };

    const starting = app.startGame(false);
    app.destroy();
    resolveScene(scene);
    await starting;

    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(app.player).toBeNull();
    expect(app.director).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("rolls back an initialized player and scene when later startup fails", async () => {
    const fakeWindow = createEventTarget();
    const fakeDocument = createEventTarget();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const characterController = {
      enableAutostep: vi.fn(),
      enableSnapToGround: vi.fn(),
      setApplyImpulsesToDynamicBodies: vi.fn(),
    };
    const world = {
      createRigidBody: vi.fn(() => ({})),
      createCollider: vi.fn(() => ({})),
      createCharacterController: vi.fn(() => characterController),
      removeCharacterController: vi.fn(),
      removeCollider: vi.fn(),
      removeRigidBody: vi.fn(),
    };
    const chainableBody = { setTranslation: vi.fn(() => ({})) };
    const scene = {
      RAPIER: {
        RigidBodyDesc: { kinematicPositionBased: vi.fn(() => chainableBody) },
        ColliderDesc: { capsule: vi.fn(() => ({})) },
      },
      world,
      camera: {},
      renderer: { domElement: createElement() },
      interactables: [],
      objects: { shadowQuest: {} },
      dispose: vi.fn(),
    };
    const retryError = new Error("retry startup failed");
    createSceneMock.mockResolvedValueOnce(scene).mockRejectedValueOnce(retryError);
    const app = new DesktopApp({});
    app.ui = {
      elements: { sceneHost: {}, pairingStatus: { innerHTML: "" } },
      showLoading: vi.fn(),
      showPairing: vi.fn(),
      setPrompt: vi.fn(),
      setObjective: vi.fn(),
    };
    app.audio = { start: vi.fn() };
    const cleanupError = new Error("startup cleanup failed");
    app.phone = { send: vi.fn(() => { throw cleanupError; }) };

    await expect(app.startGame(false)).resolves.toBeUndefined();

    expect(world.removeCharacterController).toHaveBeenCalledExactlyOnceWith(characterController);
    expect(world.removeCollider).toHaveBeenCalledOnce();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).not.toBe(cleanupError);
    expect(consoleError).toHaveBeenCalledWith("Failed to clean up scene startup:", cleanupError);
    expect(app.started).toBe(false);
    expect(app.ui.showLoading).toHaveBeenLastCalledWith(false);
    expect(app.ui.showPairing).toHaveBeenLastCalledWith(true);
    expect(app.foundPhone).toBeNull();
    expect(app.doorDefense).toBeNull();
    expect(app.shadowQuest).toBeNull();
    expect(app.player).toBeNull();
    expect(app.director).toBeNull();
    expect(app.experience).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    app.phone.send.mockImplementation(() => {});
    await expect(app.startGame(false)).resolves.toBeUndefined();

    expect(createSceneMock).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenLastCalledWith(retryError);
    expect(app.started).toBe(false);
  });

  it.each([
    [
      new EnvironmentLoadError("manifest-invalid", "private detail"),
      { code: "manifest-invalid", message: "村庄配置有误。", retryable: true },
    ],
    [
      new EnvironmentLoadError("chunk-load", "private detail", {
        chunkId: "western-core",
        status: 404,
        phase: "response",
        url: "https://game.test/assets/environment/elderboom-v1/chunks/western-core.glb",
        cause: new Error("request failed with status 404 at D:\\private\\asset.glb"),
      }),
      { code: "chunk-load", message: "村庄资源尚未准备好。", retryable: true },
    ],
    [
      new EnvironmentLoadError("chunk-invalid", "private detail"),
      { code: "chunk-invalid", message: "村庄资源无法解析。", retryable: true },
    ],
  ])("classifies environment startup errors without exposing private details", async (error, expected) => {
    const { app } = createSceneStartHarness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    createSceneMock.mockRejectedValueOnce(error);

    await app.startGame(false);

    expect(createSceneMock).toHaveBeenCalledWith(
      app.ui.elements.sceneHost,
      { signal: expect.any(AbortSignal) },
    );
    expect(app.ui.showSceneError).toHaveBeenLastCalledWith(expected);
    expect(JSON.stringify(app.ui.showSceneError.mock.calls)).not.toContain("D:\\private");
    expect(app.started).toBe(false);
  });

  it("retries a failed scene once, suppresses a double click, and starts the replacement", async () => {
    const { app } = createSceneStartHarness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(HandTrackingDirector.prototype, "load").mockResolvedValue(true);
    const failure = new EnvironmentLoadError("manifest-fetch", "offline");
    const replacement = deferred();
    const scene = createStartableScene();
    createSceneMock.mockRejectedValueOnce(failure).mockReturnValueOnce(replacement.promise);
    const clearTransient = vi.spyOn(app, "clearTransientInteractionState");

    await app.startGame(false);
    const firstRetry = app.retrySceneStart();
    const secondRetry = app.retrySceneStart();
    replacement.resolve(scene);
    await Promise.all([firstRetry, secondRetry]);

    expect(createSceneMock).toHaveBeenCalledTimes(2);
    expect(createSceneMock.mock.calls[0][1].signal).not.toBe(createSceneMock.mock.calls[1][1].signal);
    expect(app.experience).toBe(scene);
    expect(app.started).toBe(true);
    expect(app.ui.showSceneError).toHaveBeenLastCalledWith(null);
    expect(clearTransient).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("aborts a superseded generation and self-disposes its late scene", async () => {
    const { app } = createSceneStartHarness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(HandTrackingDirector.prototype, "load").mockResolvedValue(true);
    const first = deferred();
    const second = deferred();
    const staleScene = { dispose: vi.fn() };
    const currentScene = createStartableScene();
    createSceneMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const initialStart = app.startGame(false);
    const firstSignal = createSceneMock.mock.calls[0][1].signal;
    const retry = app.retrySceneStart();
    const duplicateRetry = app.retrySceneStart();

    expect(firstSignal.aborted).toBe(true);
    expect(createSceneMock).toHaveBeenCalledTimes(2);
    second.resolve(currentScene);
    await Promise.all([retry, duplicateRetry]);
    first.resolve(staleScene);
    await initialStart;

    expect(staleScene.dispose).toHaveBeenCalledOnce();
    expect(currentScene.dispose).not.toHaveBeenCalled();
    expect(app.experience).toBe(currentScene);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("aborts the owned generation before destroy cleanup and ignores a late rejection", async () => {
    const { app } = createSceneStartHarness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferred();
    createSceneMock.mockReturnValueOnce(pending.promise);

    const starting = app.startGame(false);
    const signal = createSceneMock.mock.calls[0][1].signal;
    app.destroy();

    expect(signal.aborted).toBe(true);
    pending.reject(new DOMException("stopped", "AbortError"));
    await expect(starting).resolves.toBeUndefined();
    expect(app.ui.showSceneError).toHaveBeenCalledExactlyOnceWith(null);
    expect(app.experience).toBeNull();
  });

  it("does not dispose a scene twice when destroy interrupts hand setup", async () => {
    const { app } = createSceneStartHarness();
    const scene = createStartableScene();
    const handLoad = deferred();
    createSceneMock.mockResolvedValueOnce(scene);
    vi.spyOn(HandTrackingDirector.prototype, "load").mockReturnValueOnce(handLoad.promise);

    const starting = app.startGame(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(app.handTracking).not.toBeNull();

    app.destroy();
    expect(scene.dispose).toHaveBeenCalledOnce();
    handLoad.resolve(true);
    await starting;

    expect(scene.dispose).toHaveBeenCalledOnce();
  });
});

describe("desktop village startup", () => {
  it("loads the persistent right flashlight hand and drives it from player speed", async () => {
    const { app, rightHandFlashlight } = createSceneStartHarness();
    const scene = createStartableScene();
    createSceneMock.mockResolvedValueOnce(scene);
    vi.spyOn(HandTrackingDirector.prototype, "load").mockResolvedValue(true);

    await app.startGame(false);
    expect(app.createRightHandFlashlight).toHaveBeenCalledWith({ camera: scene.camera });
    expect(rightHandFlashlight.load).toHaveBeenCalledOnce();

    const { app: tickApp } = createTickHarness();
    tickApp.player.velocity = { x: 2.8, z: 1.1 };
    tickApp.player.movementSpeed = 3.25;
    tickApp.tick(16);
    expect(tickApp.rightHandFlashlight.update).toHaveBeenCalledWith(0.016, {
      speed: Math.hypot(2.8, 1.1),
      maxSpeed: 3.25,
    });

    app.disposeRuntime();
    expect(rightHandFlashlight.destroy).toHaveBeenCalledOnce();
  });

  it("switches the desktop to a canvas-only view after scene startup", async () => {
    const { app } = createSceneStartHarness();
    const scene = createStartableScene();
    createSceneMock.mockResolvedValueOnce(scene);
    vi.spyOn(HandTrackingDirector.prototype, "load").mockResolvedValue(true);

    await app.startGame(false);

    expect(app.ui.setCleanView).toHaveBeenNthCalledWith(1, false);
    expect(app.ui.setCleanView).toHaveBeenLastCalledWith(true);
  });

  it("constructs the village director and leaves corridor defense inactive for ElderBoom", async () => {
    const { app } = createSceneStartHarness();
    const scene = createStartableScene();
    scene.objects.environment.manifest.id = "elderboom-v1";
    scene.objects.fuse = { enabled: true, root: { visible: true } };
    scene.objects.washbasin = { label: "洗手池", toggle: vi.fn(() => true) };
    createSceneMock.mockResolvedValueOnce(scene);
    vi.spyOn(HandTrackingDirector.prototype, "load").mockResolvedValue(true);

    await app.startGame(false);

    expect(app.director).toBeInstanceOf(VillageDirector);
    expect(app.doorDefense).toBeNull();
    expect(app.shadowQuest).toBeNull();
    expect(app.handleInteraction("fuse")).toBe(true);
    expect(app.ui.setObjective).toHaveBeenLastCalledWith(expect.not.stringMatching(/panel|corridor|配电箱|走廊/i));
  });
});

describe("scene startup error classification", () => {
  it.each([
    ["expected chunk 404", new EnvironmentLoadError("chunk-load", "missing", {
      status: 404,
      phase: "response",
      url: "/assets/environment/elderboom-v1/chunks/western-core.glb",
      chunkId: "western-core",
    }), "村庄资源尚未准备好。"],
    ["chunk 503", new EnvironmentLoadError("chunk-load", "unavailable", {
      status: 503,
      phase: "response",
      url: "/assets/environment/elderboom-v1/chunks/western-core.glb",
      chunkId: "western-core",
    }), "村庄资源服务暂时不可用。"],
    ["transport rejection", new EnvironmentLoadError("chunk-load", "offline", {
      phase: "request",
      url: "/assets/environment/elderboom-v1/chunks/western-core.glb",
      chunkId: "western-core",
    }), "村庄资源网络连接失败。"],
    ["invalid length", new EnvironmentLoadError("chunk-invalid", "bad length", {
      phase: "validate",
      chunkId: "western-core",
    }), "村庄资源校验失败。"],
    ["decode failure", new EnvironmentLoadError("chunk-invalid", "bad GLB", {
      phase: "decode",
      chunkId: "western-core",
    }), "村庄资源无法解析。"],
  ])("classifies %s without treating it as a missing local asset", (_label, error, message) => {
    expect(classifySceneError(error)).toMatchObject({
      code: error.code,
      message,
      retryable: true,
    });
  });

  it("silences aborted startup work", () => {
    expect(classifySceneError(new EnvironmentLoadError("chunk-load", "cancelled", {
      phase: "abort",
      chunkId: "western-core",
    }))).toEqual({ code: "aborted", message: null, retryable: false });
  });
});

describe("desktop door-defense UI", () => {
  it("prepares, shows, and releases the bounded knock cinematic video layer", async () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const video = elements.get("#knock-cinematic-video");

    expect(video).toBe(ui.elements.knockVideo);
    expect(root.innerHTML).toContain('preload="auto"');
    ui.prepareKnockVideo("/assets/cinematics/village-knock-grab-v1.mp4");
    expect(video.src).toBe("/assets/cinematics/village-knock-grab-v1.mp4");
    expect(video.hidden).toBe(true);
    await ui.playKnockVideo();
    expect(video.hidden).toBe(false);
    expect(video.dataset.active).toBe("true");
    ui.releaseKnockVideo();
    expect(video.hidden).toBe(true);
    expect(video.dataset.active).toBe("false");
  });

  it("keeps runtime UI endpoints available behind a canvas-only clean view", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const shell = elements.get(".desktop-shell");

    ui.setCleanView(true);
    ui.setSubtitle("hidden dialogue", true);
    ui.setPlayerTranscript("visible player speech", true);
    ui.setPrompt("hidden prompt");

    expect(ui.elements.shell).toBe(shell);
    expect(shell.dataset.cleanView).toBe("true");
    expect(ui.elements.subtitle.hidden).toBe(false);
    expect(ui.elements.playerTranscript.hidden).toBe(false);
    expect(ui.elements.playerTranscript.textContent).toBe("visible player speech");
    expect(ui.elements.prompt.hidden).toBe(false);

    ui.setCleanView(false);
    expect(shell.dataset.cleanView).toBe("false");
  });

  it("renders one Lucide retry command and presents concise scene errors", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const retry = elements.get("#scene-retry-button");
    const status = elements.get("#pairing-status");

    expect(root.innerHTML.match(/id="scene-retry-button"/g)).toHaveLength(1);
    expect(root.innerHTML).toContain('data-lucide="rotate-ccw"');
    expect(ui.elements.sceneRetryButton).toBe(retry);

    ui.showSceneError({
      code: "chunk-load",
      message: "村庄资源尚未准备好。",
      retryable: true,
    });
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toBe("村庄资源尚未准备好。");
    expect(retry.hidden).toBe(false);

    ui.showSceneError(null);
    expect(status.dataset.state).toBe("idle");
    expect(retry.hidden).toBe(true);
  });

  it("renders acquired slots only and owns a bounded relative inventory cursor", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const bar = elements.get("#inventory-bar");
    const items = elements.get("#inventory-items");
    const cursor = elements.get("#inventory-cursor");
    bar.getBoundingClientRect = () => ({ width: 280, height: 72 });

    ui.setInventory({ items: [], equippedId: null, hoveredId: null });
    expect(bar.hidden).toBe(false);
    expect(items.innerHTML).toBe("");
    expect(ui.inventoryItemAtCursor()).toBeNull();

    ui.setInventory({
      items: [{ id: "spare-fuse", enabled: true }],
      equippedId: "spare-fuse",
      hoveredId: null,
    }, { entryEdge: "right", entryY: 0.5 });
    expect(items.innerHTML).toContain('data-inventory-id="spare-fuse"');
    expect(ui.inventoryItemAtCursor()).toBeNull();
    expect(cursor.style.transform).toBe("translate3d(275px, 36px, 0)");

    expect(ui.moveInventoryCursor(-135, 0)).toBe("spare-fuse");

    expect(ui.moveInventoryCursor(999, 999)).toBeNull();
    expect(cursor.style.transform).toBe("translate3d(275px, 67px, 0)");
    ui.closeInventory();
    expect(bar.hidden).toBe(true);
  });

  it("renders a hidden microphone status and toggles it without text", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const voiceRecording = elements.get("#voice-recording");

    expect(root.innerHTML).toContain('id="voice-recording"');
    expect(root.innerHTML).toContain('data-lucide="mic"');
    expect(ui.elements.voiceRecording).toBe(voiceRecording);

    ui.setVoiceRecording(true);
    expect(voiceRecording.hidden).toBe(false);
    ui.setVoiceRecording(false);
    expect(voiceRecording.hidden).toBe(true);
  });

  it("shows speech-recognition status separately from dialogue subtitles", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const voiceStatus = elements.get("#npc-voice-status");

    expect(root.innerHTML).toContain('id="npc-voice-status"');
    expect(ui.elements.npcVoiceStatus).toBe(voiceStatus);

    ui.setNpcVoiceStatus({ message: "正在识别", state: "capturing" });
    expect(voiceStatus.textContent).toBe("正在识别");
    expect(voiceStatus.dataset.state).toBe("capturing");
    expect(voiceStatus.hidden).toBe(false);

    ui.setNpcVoiceStatus(null);
    expect(voiceStatus.textContent).toBe("");
    expect(voiceStatus.hidden).toBe(true);
  });

  it("clamps progress into aria percent and a stable scale transform with Chinese status", () => {
    const { root, elements } = createRoot();
    const ui = createDesktopUI(root);
    const band = elements.get("#door-defense");
    const track = elements.get(".door-defense-track");
    const fill = elements.get(".door-defense-track > span");
    const status = elements.get("#door-defense-status");

    ui.setDoorDefense({ visible: true, progress: 0.375, status: "bracing" });
    expect(band.hidden).toBe(false);
    expect(track.getAttribute("aria-valuenow")).toBe("38");
    expect(fill.style.transform).toBe("scaleX(0.375)");
    expect(status.textContent).toBe("坚持抵住门");

    ui.setDoorDefense({ visible: true, progress: 2, status: "failed" });
    expect(track.getAttribute("aria-valuenow")).toBe("100");
    expect(fill.style.transform).toBe("scaleX(1)");
    expect(status.textContent).toBe("没抵住，再来");

    ui.setDoorDefense({ visible: false, progress: -1, status: "secured" });
    expect(band.hidden).toBe(true);
    expect(track.getAttribute("aria-valuenow")).toBe("0");
    expect(fill.style.transform).toBe("scaleX(0)");
  });

  it("contains the progressbar but no completion or restart DOM", () => {
    const { root } = createRoot();
    const ui = createDesktopUI(root);

    expect(root.innerHTML).toContain('role="progressbar"');
    expect(root.innerHTML).toContain('aria-labelledby="door-defense-status"');
    expect(root.innerHTML).not.toContain("completion-overlay");
    expect(root.innerHTML).not.toContain("restart-button");
    expect(ui.elements).not.toHaveProperty("completion");
    expect(ui).not.toHaveProperty("showCompletion");
    expect(DesktopApp.prototype.completeGame).toBeUndefined();
  });
});

describe("desktop scene audio", () => {
  it("implements all door and phone transition cues and removes elevator", () => {
    const { AudioContext, oscillators, sources } = createAudioContextHarness();
    vi.stubGlobal("window", { AudioContext });
    const audio = createGameAudio();
    audio.start();

    for (const cue of [
      "lock-twist",
      "door-rattle",
      "door-impact",
      "brace-strain",
      "door-latch",
      "phone-pickup",
      "phone-release",
    ]) {
      const before = oscillators.length + sources.length;
      audio.cue(cue);
      expect(oscillators.length + sources.length, cue).toBeGreaterThan(before);
    }

    const beforeElevator = oscillators.length + sources.length;
    audio.cue("elevator");
    expect(oscillators.length + sources.length).toBe(beforeElevator);
    audio.dispose();
  });
});
