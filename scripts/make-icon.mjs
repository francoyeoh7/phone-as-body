import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0e100f"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#f1f0e8" stroke-width="28"/>
  <circle cx="256" cy="256" r="64" fill="#f1f0e8"/>
  <rect x="230" y="56" width="52" height="22" rx="11" fill="#f1f0e8"/>
</svg>`;

const outDir = path.resolve("electron", "icons");
mkdirSync(outDir, { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(outDir, "icon.png"), png);
console.log("wrote electron/icons/icon.png");
