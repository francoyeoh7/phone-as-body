import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "windows-speech.ps1");

function runPowerShell(inputPath) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-InputPath", inputPath,
      "-Culture", "zh-CN",
    ], { windowsHide: true });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        const result = JSON.parse(line || "null");
        const text = String(result?.text ?? "").trim();
        resolve(text ? { text, confidence: Number(result?.confidence) || 0.35 } : null);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function transcribeWithWindowsSpeech(bytes, mimeType) {
  if (process.platform !== "win32" || mimeType !== "audio/wav" || !Buffer.isBuffer(bytes) || bytes.length === 0) return null;
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, "corridor-617-speech-"));
  const inputPath = path.join(directory, "voice.wav");
  try {
    await writeFile(inputPath, bytes);
    return await runPowerShell(inputPath);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(`${tempRoot}${path.sep}`)) await rm(resolved, { recursive: true, force: true });
  }
}
