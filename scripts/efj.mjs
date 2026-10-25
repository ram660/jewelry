#!/usr/bin/env node
// Command-line helper for the EFJ Studio app. It only talks to the app's own REST API (default
// http://localhost:3000, override with EFJ_URL). It never calls any AI service and holds no credentials.
//
//   node scripts/efj.mjs list
//   node scripts/efj.mjs show <productId>
//   node scripts/efj.mjs create "<name>" <photo...> [--category ring]
//   node scripts/efj.mjs update <productId> <file.json | ->
//   node scripts/efj.mjs images <productId>
//   node scripts/efj.mjs score <imageId> <0-100|null> [notes...]

import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.EFJ_URL || "http://localhost:3000").replace(/\/+$/, "");
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    die(`Could not reach the app at ${BASE}. Is it running? Start it with: npm run dev`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const lines = [`Error ${res.status}: ${json?.error ?? text.slice(0, 300)}`];
    if (Array.isArray(json?.problems)) for (const p of json.problems) lines.push(`  - ${p}`);
    die(lines.join("\n"));
  }
  return json;
}

const id = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) die(`${what} must be a positive whole number, got "${v}".`);
  return n;
};

const money = (v) => (v == null ? "-" : `$${v}`);

const commands = {
  async list() {
    const products = await call("GET", "/api/products");
    if (!products.length) return console.log("No products yet.");
    for (const p of products) {
      console.log(`#${p.id}  ${p.sku}  ${(p.name || "(unnamed)").padEnd(32)}  ${p.status.padEnd(9)}  ${money(p.price_cad).padStart(7)}  stock ${p.stock_qty}${p.analysed_at ? "" : "  [not analysed]"}`);
    }
  },

  async show(pid) {
    const n = id(pid, "productId");
    const [p, imgs] = await Promise.all([call("GET", `/api/products/${n}`), call("GET", `/api/products/${n}/images`)]);
    console.log(JSON.stringify(p, null, 2));
    console.log("\nImages:");
    printImages(imgs);
  },

  async create(...args) {
    let category = "other";
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--category") category = args[++i] ?? die("--category needs a value, e.g. ring.");
      else rest.push(args[i]);
    }
    const [name, ...photos] = rest;
    if (name === undefined || !photos.length) die('Usage: create "<name>" <photo...> [--category ring]');

    const form = new FormData();
    form.set("name", name);
    form.set("category", category);
    for (const p of photos) {
      const ext = path.extname(p).toLowerCase();
      if (!TYPES[ext]) die(`"${p}" is not a JPG, PNG or WebP photo (HEIC is not supported yet).`);
      let st;
      try { st = fs.statSync(p); } catch { die(`Photo not found: ${p}`); }
      if (!st.isFile()) die(`Not a file: ${p}`);
      if (st.size > MAX_PHOTO_BYTES) die(`"${p}" is larger than 25 MB.`);
      form.append("files", await fs.openAsBlob(p, { type: TYPES[ext] }), path.basename(p));
    }
    const out = await call("POST", "/api/products", form);
    console.log(JSON.stringify(out));
  },

  async update(pid, file) {
    const n = id(pid, "productId");
    if (!file) die("Usage: update <productId> <file.json | ->");
    let raw;
    try { raw = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8"); } catch { die(`Could not read ${file}`); }
    let patch;
    try { patch = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch (e) { die(`${file} is not valid JSON: ${e.message}`); }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) die("The JSON must be an object of fields to change.");
    const p = await call("PATCH", `/api/products/${n}`, patch);
    console.log(JSON.stringify({ id: p.id, sku: p.sku, name: p.name, status: p.status, updated_at: p.updated_at }));
  },

  async images(pid) {
    printImages(await call("GET", `/api/products/${id(pid, "productId")}/images`));
  },

  async score(iid, score, ...notes) {
    const n = id(iid, "imageId");
    if (score === undefined) die("Usage: score <imageId> <0-100|null> [notes...]");
    const body = {};
    if (score === "null") body.fidelity_score = null;
    else {
      // Plain digits only: Number() would accept "", "0x10" and "1e1".
      if (!/^\d{1,3}$/.test(score) || Number(score) > 100) die("The score must be a whole number from 0 to 100 (or the word null).");
      body.fidelity_score = Number(score);
    }
    if (notes.length) body.fidelity_notes = notes.join(" ");
    const im = await call("PATCH", `/api/images/${n}`, body);
    console.log(JSON.stringify({ id: im.id, fidelity_score: im.fidelity_score, fidelity_notes: im.fidelity_notes }));
  },
};

function printImages(imgs) {
  if (!imgs.length) return console.log("  (none)");
  for (const i of imgs) {
    const score = i.fidelity_score == null ? "-" : `${i.fidelity_score}%`;
    console.log(`  image ${i.id}  ${i.kind.padEnd(9)}  ${i.approved ? "approved  " : "needs review"}  match ${score.padStart(4)}  ${i.label ?? ""}  file: ${i.path}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  die(`Usage:
  node scripts/efj.mjs list
  node scripts/efj.mjs show <productId>
  node scripts/efj.mjs create "<name>" <photo...> [--category ring]
  node scripts/efj.mjs update <productId> <file.json | ->
  node scripts/efj.mjs images <productId>
  node scripts/efj.mjs score <imageId> <0-100|null> [notes...]`, cmd ? 2 : 0);
}
await commands[cmd](...args);
