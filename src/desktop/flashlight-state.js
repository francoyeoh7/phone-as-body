// Flashlight on/off without touching Object3D.visible: adding or removing the
// two spotlights from the scene graph forces three.js to recompile every lit
// material in the village, which stalls the main thread for seconds. Dimming
// to intensity 0 keeps the light count constant and toggles instantly.

export function isFlashlightEnabled(group) {
  if (!group) return false;
  return group.userData?.flashlightEnabled !== false;
}

export function setFlashlightEnabled(group, enabled) {
  if (!group?.userData) return false;
  const on = enabled === true;
  for (const entry of group.userData.flashlightLights ?? []) {
    entry.light.intensity = on ? entry.intensity : 0;
  }
  group.userData.flashlightEnabled = on;
  return true;
}

export function toggleFlashlight(group) {
  const next = !isFlashlightEnabled(group);
  setFlashlightEnabled(group, next);
  return next;
}
