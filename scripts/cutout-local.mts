// Try the on-computer BiRefNet cutout without starting the app.
//
//   node scripts/cutout-local.mts <photo> [output-folder]     cut out one of your photos
//   node scripts/cutout-local.mts --synthetic [output-folder]  run on a drawn test picture
//
// Writes <name>-cutout.png (transparent) and <name>-preview.jpg (on magenta, so edges are easy to judge), and prints the time.
// Settings: BIREFNET_MODEL=lite|full, BIREFNET_DEVICE=auto|cpu|dml (see .env.example).
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Let Node find "./db" as "./db.ts" (the app's bundler does this normally).
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (/^[.][.]?[/]/.test(s) && !/[.]\\w+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
}`),
  import.meta.url
);

const { localCutout, localModelPath } = await import("../src/lib/localCutout.ts");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/cutout-local.mts <photo> [output-folder]   or   --synthetic [output-folder]");
  process.exit(1);
}
if (!localModelPath()) {
  console.error("No local model installed. Run: node scripts/get-birefnet.mjs lite");
  process.exit(1);
}

const outDir = path.resolve(process.argv[3] ?? "cutout-test");
fs.mkdirSync(outDir, { recursive: true });

async function syntheticPhoto(): Promise<Buffer> {
  const W = 1400, H = 1000;
  let stripes = "";
  for (let i = 0; i < 60; i++) {
    const c = 90 + ((i * 37) % 70);
    stripes += `<rect x="0" y="${i * (H / 60)}" width="${W}" height="${H / 60 + 1}" fill="rgb(${c + 40},${c},${c - 30})"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e08a"/><stop offset=".5" stop-color="#c9951f"/><stop offset="1" stop-color="#8a5f0e"/></linearGradient>
    <radialGradient id="s" cx=".4" cy=".4"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9fd0ff"/></radialGradient></defs>
    ${stripes}
    <circle cx="480" cy="520" r="230" fill="none" stroke="url(#g)" stroke-width="64"/>
    <circle cx="480" cy="270" r="62" fill="url(#s)" stroke="url(#g)" stroke-width="14"/>
    <path d="M 900 300 Q 1050 720 1250 300" fill="none" stroke="url(#g)" stroke-width="12" stroke-dasharray="26 8"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

const synthetic = arg === "--synthetic";
const input = synthetic ? await syntheticPhoto() : fs.readFileSync(arg);
const name = synthetic ? "synthetic" : path.parse(arg).name;
if (synthetic) fs.writeFileSync(path.join(outDir, "synthetic-input.jpg"), input);

for (let run = 1; run <= 2; run++) {
  const r = await localCutout(input);
  console.log(`run ${run}: ${r.ms} ms, kept ${(r.coverage * 100).toFixed(1)}% of the picture, ${r.via}`);
  if (run === 2) {
    const meta = await sharp(r.png).metadata();
    fs.writeFileSync(path.join(outDir, `${name}-cutout.png`), r.png);
    await sharp({ create: { width: meta.width!, height: meta.height!, channels: 3, background: "#ff00ff" } })
      .composite([{ input: r.png }])
      .jpeg({ quality: 90 })
      .toFile(path.join(outDir, `${name}-preview.jpg`));
    console.log(`Saved to ${outDir}`);
  }
}
console.log("(run 1 includes loading the model; run 2 is the speed you get on every later photo)");
