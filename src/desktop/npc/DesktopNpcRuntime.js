import * as THREE from "three";
import { NpcConversationCoordinator } from "./NpcConversationCoordinator.js";
import { NpcPerformer } from "./NpcPerformer.js";
import { NpcSpatialVoice } from "./NpcSpatialVoice.js";
import { RealtimeNpcSession } from "./RealtimeNpcSession.js";

export async function transcribeVoiceClip(clip, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!fetchImpl || !clip?.data) throw new Error("Voice transcription is unavailable");
  const response = await fetchImpl("/api/npc/transcribe", {
    method: "POST",
    headers: { "Content-Type": clip.mimeType || "audio/webm" },
    body: clip.data,
  });
  if (!response?.ok) throw new Error(`Voice transcription failed: ${response?.status ?? "network"}`);
  return response.json();
}

async function requestPerformance(payload, fetchImpl) {
  if (!fetchImpl) throw new Error("NPC AI is unavailable");
  const response = await fetchImpl("/api/npc/perform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: payload.signal,
  });
  if (!response?.ok) throw new Error(`NPC AI failed: ${response?.status ?? "network"}`);
  return response.json();
}

function createOcclusionTest(roots) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const target = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const candidates = Array.isArray(roots) ? roots.filter(Boolean) : [];
  return (_id, mouth, camera) => {
    if (!mouth?.getWorldPosition || !camera?.getWorldPosition || candidates.length === 0) return false;
    camera.getWorldPosition(origin);
    mouth.getWorldPosition(target);
    const distance = origin.distanceTo(target);
    if (distance <= 0.2) return false;
    direction.copy(target).sub(origin).normalize();
    raycaster.set(origin, direction);
    raycaster.far = Math.max(0, distance - 0.15);
    return raycaster.intersectObjects(candidates, true).length > 0;
  };
}

export function createDesktopNpcRuntime({
  npcSystem,
  camera,
  ui,
  staticOccluderRoots = [],
  onTranscript = null,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  realtimeFactory = null,
  spatialVoiceFactory = (options) => new NpcSpatialVoice(options),
  performerFactory = (options) => new NpcPerformer(options),
  coordinatorFactory = (options) => new NpcConversationCoordinator(options),
} = {}) {
  if (!npcSystem || !camera) throw new TypeError("Desktop NPC runtime requires village NPCs and camera");
  const roster = npcSystem.roster;
  let subtitleTimer = null;
  const showSubtitle = (text, durationMs) => {
    if (!text) return;
    ui?.setSubtitle?.(text, true);
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => ui?.setSubtitle?.("", false), durationMs);
  };
  const publishPlayerTranscript = (result) => {
    const transcript = String(result?.transcript ?? "").trim();
    if (transcript) {
      if (ui?.setPlayerTranscript) ui.setPlayerTranscript(transcript, true);
      else showSubtitle(`你：${transcript}`, 4_800);
      onTranscript?.(result);
    }
    return result;
  };
  const spatialVoice = spatialVoiceFactory({
    camera,
    npcSystem,
    onSubtitle: ({ npcId, speech }) => {
      const name = roster?.get?.(npcId)?.displayName ?? npcId;
      showSubtitle(`${name}: ${speech}`, 5_500);
    },
  });
  const performer = performerFactory({ roster, remote: (payload) => requestPerformance(payload, fetchImpl) });
  const coordinator = coordinatorFactory({
    npcSystem,
    spatialVoice,
    roster,
    performer,
    camera,
    realtimeFactory: realtimeFactory ?? ((options) => new RealtimeNpcSession(options)),
    transcriber: async (clip) => publishPlayerTranscript(await transcribeVoiceClip(clip, { fetchImpl })),
    onRecording: (active) => ui?.setVoiceRecording?.(active),
    onStatus: (status) => {
      if (ui?.setNpcVoiceStatus) ui.setNpcVoiceStatus(status);
      else if (status?.message) showSubtitle(status.message, 3_200);
    },
  });
  const occlusionTest = createOcclusionTest(staticOccluderRoots);
  let destroyed = false;
  return {
    coordinator,
    spatialVoice,
    beginCapture: () => coordinator.beginCapture(),
    cancelCapture: () => coordinator.cancelCapture(),
    acceptVoiceClip: (clip) => coordinator.acceptVoiceClip(clip),
    acceptVoiceFrame: (frame) => coordinator.acceptVoiceFrame(frame),
    acceptTranscript: (result) => {
      publishPlayerTranscript(result);
      return coordinator.acceptTranscript(result);
    },
    update() {
      if (destroyed) return;
      coordinator.update();
      spatialVoice.updateOcclusion(occlusionTest);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(subtitleTimer);
      coordinator.destroy();
      spatialVoice.destroy();
    },
  };
}
