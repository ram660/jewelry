#!/usr/bin/env node
// Downloads a BiRefNet cutout model (MIT licence) so cutouts can run on this computer with no key and no upload.
//
//   node scripts/get-birefnet.mjs lite   about 214 MB, runs on any laptop (default)
//   node scripts/get-birefnet.mjs lite-fp16   about 109 MB, half precision, smallest download, slower on most CPUs
//   node scripts/get-birefnet.mjs full   about 467 MB (half precision), sharper on fine chains, needs more memory
//
// Files go to ~/.efj-studio/models (set EFJ_MODEL_DIR to move it). The download is checked against the SHA-256
// published by Hugging Face and deleted if it does not match.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";

const MODELS = {
  lite: {
    file: "birefnet-lite.onnx",
    url: "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx",
    bytes: 224005088,
    sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
  },
  "lite-fp16": {
    file: "birefnet-lite-fp16.onnx",
    url: "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx",
    bytes: 114538221,
    sha256: "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402",
  },
  full: {
    file: "birefnet-full-fp16.onnx",
    url: "https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx",
    bytes: 489666272,
    sha256: "3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09",
  },
};

const which = process.argv[2] ?? "lite";
const m = MODELS[which];
if (!m) {
  console.error(`Unknown model "${which}". Use: lite | lite-fp16 | full`);
  process.exit(1);
}

// Same folder the app looks in (see src/lib/localCutout.ts). Outside the project, so OneDrive and git never touch it.
const dir = process.env.EFJ_MODEL_DIR || path.join(os.homedir(), ".efj-studio", "models");
const dest = path.join(dir, m.file);
fs.mkdirSync(dir, { recursive: true });

async function sha256Of(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

if (fs.existsSync(dest) && fs.statSync(dest).size === m.bytes && (await sha256Of(dest)) === m.sha256) {
  console.log(`Already installed and verified: ${dest}`);
  process.exit(0);
}

console.log(`Downloading ${which} model (${(m.bytes / 1048576).toFixed(0)} MB) to ${dest}`);
const res = await fetch(m.url);
if (!res.ok || !res.body) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}

const part = dest + ".part";
const hash = crypto.createHash("sha256");
let got = 0;
let lastPct = -1;
const out = fs.createWriteStream(part);
for await (const chunk of Readable.fromWeb(res.body)) {
  hash.update(chunk);
  got += chunk.length;
  if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
  const pct = Math.floor((got / m.bytes) * 10) * 10;
  if (pct !== lastPct) { lastPct = pct; process.stdout.write(`  ${pct}%\n`); }
}
await new Promise((r) => out.end(r));

if (got !== m.bytes || hash.digest("hex") !== m.sha256) {
  fs.rmSync(part, { force: true });
  console.error("The downloaded file does not match the published checksum. It was deleted. Try again.");
  process.exit(1);
}
fs.renameSync(part, dest);
console.log(`Installed and verified: ${dest}`);
