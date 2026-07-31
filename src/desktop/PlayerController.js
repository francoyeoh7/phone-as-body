import * as THREE from "three";
import { cameraRelativeMovement, dampVector } from "../shared/movement.js";
import { integrateViewMotion } from "../shared/view-motion.js";
import { chooseAssistedTarget } from "../shared/interaction.js";

export class PlayerController {
  constructor({ RAPIER, world, camera, renderer, interactables, onInteract, onAction, onPrompt }) {
    this.world = world;
    this.camera = camera;
    this.renderer = renderer;
    this.interactables = interactables;
    this.onInteract = onInteract;
    this.onAction = onAction;
    this.onPrompt = onPrompt;
    this.keys = new Set();
    this.phoneInput = { viewMotion: { x: 0, y: 0, confidence: 0 }, move: { x: 0, y: 0 } };
    this.phoneConnected = false;
    this.velocity = { x: 0, z: 0 };
    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.viewVelocity = { x: 0, y: 0 };
    this.paused = false;
    this.fallback = false;
    this.settings = { sensitivity: 1, smoothing: 0.55, invertY: false };
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
    if (active) this.clearViewVelocity();
  }

  setControllerInput(input, connected) {
    this.phoneInput = input ?? {
      viewMotion: { x: 0, y: 0, confidence: 0 },
      move: { x: 0, y: 0 },
    };
    this.phoneConnected = connected;
    if (!connected) this.clearViewVelocity();
  }

  setSettings(settings = {}) {
    const sensitivity = Number(settings.sensitivity);
    const smoothing = Number(settings.smoothing);
    this.settings = {
      ...this.settings,
      sensitivity: Number.isFinite(sensitivity) ? Math.min(2, Math.max(0.4, sensitivity)) : this.settings.sensitivity,
      smoothing: Number.isFinite(smoothing) ? Math.min(1, Math.max(0, smoothing)) : this.settings.smoothing,
      invertY: typeof settings.invertY === "boolean" ? settings.invertY : this.settings.invertY,
    };
  }

  recenter() {
    this.clearViewVelocity();
  }

  clearViewVelocity() {
    this.viewVelocity = { x: 0, y: 0 };
  }

  update(delta) {
    if (this.paused) {
      this.velocity = dampVector(this.velocity, { x: 0, z: 0 }, 15, delta);
      return;
    }

    if (this.phoneConnected && !this.fallback) {
      const view = integrateViewMotion(
        {
          yaw: this.cameraYaw,
          pitch: this.cameraPitch,
          vx: this.viewVelocity.x,
          vy: this.viewVelocity.y,
        },
        this.phoneInput.viewMotion,
        delta,
        this.settings,
      );
      this.cameraYaw = view.yaw;
      this.cameraPitch = view.pitch;
      this.viewVelocity = { x: view.vx, y: view.vy };
    }

    const move = this.phoneConnected && !this.fallback ? this.phoneInput.move : this.keyboardVector();
    const target = cameraRelativeMovement(move, this.cameraYaw);
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
    this.camera.rotation.y = this.cameraYaw;
    this.camera.rotation.x = this.cameraPitch;
    this.updateInteraction();
  }

  syncAfterPhysics() {
    const translation = this.body.translation();
    this.camera.position.set(translation.x, translation.y + 0.55, translation.z);
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
    if (selected !== this.selected) {
      if (this.selected?.halo) this.selected.halo.visible = false;
      if (selected?.halo) selected.halo.visible = true;
      this.selected = selected;
      this.onPrompt?.(selected?.label ?? null);
    }
  }

  interact() {
    if (this.selected) this.onInteract?.(this.selected.id);
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.clearViewVelocity();
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
    if (!this.pointerLocked || this.paused) return;
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
