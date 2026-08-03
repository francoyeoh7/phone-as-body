import * as THREE from "three";
import { cameraRelativeMovement, dampVector } from "../shared/movement.js";
import { chooseAssistedTarget } from "../shared/interaction.js";

export class PlayerController {
  constructor({ RAPIER, world, camera, renderer, interactables, onInteract, onAction, onPrompt, onTarget }) {
    this.world = world;
    this.camera = camera;
    this.renderer = renderer;
    this.interactables = interactables;
    this.onInteract = onInteract;
    this.onAction = onAction;
    this.onPrompt = onPrompt;
    this.onTarget = onTarget;
    this.keys = new Set();
    this.phoneInput = {
      seq: -1,
      viewDelta: { yaw: 0, pitch: 0 },
      move: { x: 0, y: 0 },
      clutch: false,
    };
    this.phoneConnected = false;
    this.velocity = { x: 0, z: 0 };
    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.cameraRenderYaw = 0;
    this.cameraRenderPitch = 0;
    this.pitchOverflow = 0;
    this.lastViewSequence = -1;
    this.paused = false;
    this.fallback = false;
    this.settings = { sensitivity: 1, smoothing: 0.18, invertY: false };
    this.aimAssist = null;
    this.cinematic = false;
    this.raycaster = new THREE.Raycaster();
    this.pointerLocked = false;
    this.selected = null;
    this.forward = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();

    const bodyDescription = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.05, 1.2);
    this.body = world.createRigidBody(bodyDescription);
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.52, 0.32), this.body);
    this.characterController = world.createCharacterController(0.01);
    this.characterController.enableAutostep(0.3, 0.16, true);
    this.characterController.enableSnapToGround(0.2);
    this.characterController.setApplyImpulsesToDynamicBodies(true);

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handlePointerLock = this.handlePointerLock.bind(this);
    this.handleCanvasClick = () => renderer.domElement.requestPointerLock?.();
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("pointerlockchange", this.handlePointerLock);
    renderer.domElement.addEventListener("click", this.handleCanvasClick);
  }

  setFallback(active) {
    this.fallback = active;
    if (active) this.recenter();
  }

  setControllerInput(input, connected) {
    this.phoneInput = input ?? {
      seq: -1,
      viewDelta: { yaw: 0, pitch: 0 },
      move: { x: 0, y: 0 },
      clutch: false,
    };
    this.phoneConnected = connected;
    if (!connected) this.recenter();
  }

  setSettings(settings = {}) {
    const sensitivity = Number(settings.sensitivity);
    const smoothing = Number(settings.smoothing);
    this.settings = {
      ...this.settings,
      sensitivity: Number.isFinite(sensitivity) ? Math.min(1.6, Math.max(0.6, sensitivity)) : this.settings.sensitivity,
      smoothing: Number.isFinite(smoothing) ? Math.min(1, Math.max(0, smoothing)) : this.settings.smoothing,
      invertY: typeof settings.invertY === "boolean" ? settings.invertY : this.settings.invertY,
    };
  }

  recenter() {
    this.lastViewSequence = this.phoneInput?.seq ?? this.lastViewSequence;
    this.pitchOverflow = 0;
  }

  applyPhoneViewDelta(input = this.phoneInput) {
    const sequence = Number.isInteger(input?.seq) ? input.seq : -1;
    if (sequence <= this.lastViewSequence) return;
    const delta = input?.viewDelta;
    if (!delta || !Number.isFinite(delta.yaw) || !Number.isFinite(delta.pitch)) {
      this.lastViewSequence = sequence;
      return;
    }
    const sensitivity = Number.isFinite(this.settings.sensitivity) ? this.settings.sensitivity : 1;
    const invertY = this.settings.invertY ? -1 : 1;
    const degreesToRadians = Math.PI / 180;
    const clutchActive = input?.clutch !== false;
    if (!clutchActive) this.pitchOverflow = 0;
    if (clutchActive) {
      this.cameraYaw += delta.yaw * sensitivity * degreesToRadians;
      let pitchRemaining = delta.pitch * sensitivity * invertY * degreesToRadians;
      if (this.pitchOverflow !== 0 && pitchRemaining !== 0 && Math.sign(this.pitchOverflow) !== Math.sign(pitchRemaining)) {
        const unwind = Math.min(Math.abs(this.pitchOverflow), Math.abs(pitchRemaining));
        this.pitchOverflow -= Math.sign(this.pitchOverflow) * unwind;
        pitchRemaining -= Math.sign(pitchRemaining) * unwind;
      }
      if (pitchRemaining !== 0) {
        const previousPitch = this.cameraPitch;
        const nextPitch = Math.max(-1.25, Math.min(1.25, previousPitch + pitchRemaining));
        this.cameraPitch = nextPitch;
        this.pitchOverflow += pitchRemaining - (nextPitch - previousPitch);
      }
    }
    this.lastViewSequence = sequence;
  }

  updateCameraPresentation(delta) {
    if (!Number.isFinite(this.cameraRenderYaw)) this.cameraRenderYaw = this.cameraYaw;
    if (!Number.isFinite(this.cameraRenderPitch)) this.cameraRenderPitch = this.cameraPitch;
    const smoothing = Number.isFinite(this.settings.smoothing) ? this.settings.smoothing : 0.18;
    if (smoothing <= 0) {
      this.cameraRenderYaw = this.cameraYaw;
      this.cameraRenderPitch = this.cameraPitch;
    } else {
      const timeConstant = 0.018 + smoothing * 0.102;
      const alpha = 1 - Math.exp(-delta / timeConstant);
      this.cameraRenderYaw += (this.cameraYaw - this.cameraRenderYaw) * alpha;
      this.cameraRenderPitch += (this.cameraPitch - this.cameraRenderPitch) * alpha;
    }
    this.applyAimAssist(delta);
  }

  setAimAssist(target, strength = 0.22) {
    if (!target?.isVector3) return;
    this.aimAssist = {
      target: target.clone(),
      strength: Math.min(0.35, Math.max(0, strength)),
    };
  }

  clearAimAssist() {
    this.aimAssist = null;
  }

  applyAimAssist(delta = 1 / 60) {
    if (!this.aimAssist || !this.camera) return;
    const direction = this.aimAssist.target.clone().sub(this.camera.position).normalize();
    const targetYaw = Math.atan2(-direction.x, -direction.z);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
    const maxStep = 72 * Math.PI / 180 * Math.max(0, delta);
    const strength = 1 - Math.pow(1 - this.aimAssist.strength, Math.max(0, delta) * 60);
    const yawDifference = Math.atan2(
      Math.sin(targetYaw - this.cameraRenderYaw),
      Math.cos(targetYaw - this.cameraRenderYaw),
    );
    const yawStep = yawDifference * strength;
    const pitchStep = (targetPitch - this.cameraRenderPitch) * strength;
    this.cameraRenderYaw += Math.max(-maxStep, Math.min(maxStep, yawStep));
    this.cameraRenderPitch += Math.max(-maxStep, Math.min(maxStep, pitchStep));
  }

  update(delta) {
    if (this.paused) {
      this.velocity = dampVector(this.velocity, { x: 0, z: 0 }, 15, delta);
      return;
    }

    if (this.cinematic) {
      this.velocity = dampVector(this.velocity, { x: 0, z: 0 }, 22, delta);
      return;
    }

    if (this.phoneConnected && !this.fallback) this.applyPhoneViewDelta();
    this.updateCameraPresentation(delta);

    const move = this.phoneConnected && !this.fallback ? this.phoneInput.move : this.keyboardVector();
    const target = cameraRelativeMovement(move, this.cameraRenderYaw);
    this.velocity = dampVector(this.velocity, { x: target.x * 3.25, z: target.z * 3.25 }, 18, delta);
    this.characterController.computeColliderMovement(this.collider, {
      x: this.velocity.x * delta,
      y: 0,
      z: this.velocity.z * delta,
    });
    const translation = this.body.translation();
    const movement = this.characterController.computedMovement();
    this.body.setNextKinematicTranslation({
      x: translation.x + movement.x,
      y: translation.y + movement.y,
      z: translation.z + movement.z,
    });
    this.camera.rotation.y = this.cameraRenderYaw;
    this.camera.rotation.x = this.cameraRenderPitch;
    this.updateInteraction();
  }

  syncAfterPhysics() {
    if (this.cinematic) return;
    const translation = this.body.translation();
    this.camera.position.set(translation.x, translation.y + 0.55, translation.z);
  }

  snapshotPose() {
    const translation = this.body.translation();
    return {
      body: { x: translation.x, y: translation.y, z: translation.z },
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      cameraYaw: this.cameraYaw,
      cameraPitch: this.cameraPitch,
      cameraRenderYaw: this.cameraRenderYaw,
      cameraRenderPitch: this.cameraRenderPitch,
    };
  }

  beginCinematic() {
    this.cinematic = true;
    this.velocity = { x: 0, z: 0 };
    this.clearAimAssist();
    if (this.selected?.halo) this.selected.halo.visible = false;
    this.selected = null;
    this.onPrompt?.(null);
    this.onTarget?.({ id: null, focused: false });
  }

  setCinematicCamera(position, target) {
    if (!this.cinematic) return;
    this.camera.position.copy(position);
    this.camera.lookAt(target);
  }

  restorePose(pose) {
    if (!pose) return;
    this.body.setTranslation?.(pose.body, true);
    this.body.setNextKinematicTranslation?.(pose.body);
    this.camera.position.set(pose.camera.x, pose.camera.y, pose.camera.z);
    this.cameraYaw = pose.cameraYaw;
    this.cameraPitch = pose.cameraPitch;
    this.cameraRenderYaw = pose.cameraRenderYaw;
    this.cameraRenderPitch = pose.cameraRenderPitch;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.cameraRenderYaw;
    this.camera.rotation.x = this.cameraRenderPitch;
    this.camera.rotation.z = 0;
  }

  endCinematic() {
    this.cinematic = false;
  }

  keyboardVector() {
    return {
      x: Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")),
      y: Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS")),
    };
  }

  updateInteraction() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const enabledRoots = this.interactables
      .filter((entry) => entry.enabled && entry.root.visible)
      .map((entry) => entry.root);
    const hits = this.raycaster.intersectObjects(enabledRoots, true);
    let selected = null;
    if (hits.length > 0 && hits[0].distance <= 2.35) {
      let object = hits[0].object;
      while (object && !object.userData.interactableId) object = object.parent;
      selected = this.interactables.find((entry) => entry.id === object?.userData.interactableId) ?? null;
    }
    if (!selected) {
      this.camera.getWorldDirection(this.forward);
      const assisted = chooseAssistedTarget(
        this.interactables.map((entry) => ({
          ...entry,
          visible: entry.root.visible,
          position: entry.root.getWorldPosition(this.targetPosition.clone()),
        })),
        this.camera.position,
        this.forward,
      );
      selected = assisted ? this.interactables.find((entry) => entry.id === assisted.id) : null;
    }
    if (selected) {
      const targetPosition = selected.root.getWorldPosition(this.targetPosition.clone());
      this.setAimAssist(targetPosition, 0.28);
    } else {
      this.clearAimAssist();
    }
    if (selected !== this.selected) {
      if (this.selected?.halo) this.selected.halo.visible = false;
      if (selected?.halo) selected.halo.visible = true;
      this.selected = selected;
      this.onPrompt?.(selected?.label ?? null);
      this.onTarget?.({ id: selected?.id ?? null, focused: Boolean(selected) });
    }
  }

  interact() {
    if (!this.cinematic && this.selected) this.onInteract?.(this.selected.id);
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.recenter();
  }

  handleKeyDown(event) {
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === "KeyE") this.interact();
    if (event.code === "KeyF") this.onAction?.("flashlight");
    if (event.code === "KeyR") this.recenter();
    if (event.code === "Escape") this.onAction?.(this.paused ? "resume" : "pause");
  }

  handleKeyUp(event) {
    this.keys.delete(event.code);
  }

  handleMouseMove(event) {
    if (!this.pointerLocked || this.paused || this.cinematic) return;
    this.pitchOverflow = 0;
    this.cameraYaw -= event.movementX * 0.0022;
    this.cameraPitch = Math.max(-1.25, Math.min(1.25, this.cameraPitch - event.movementY * 0.0022));
  }

  handlePointerLock() {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  }

  destroy() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLock);
    this.renderer.domElement.removeEventListener("click", this.handleCanvasClick);
    this.world.removeCharacterController(this.characterController);
    this.world.removeCollider(this.collider, true);
    this.world.removeRigidBody(this.body);
  }
}
