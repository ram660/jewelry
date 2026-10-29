// Turn a folder of product photos into a ready-to-post Instagram kit, all on this computer (no keys, no uploads).
//
//   npm run insta -- <photo-folder> <product-name> [--template auto|<id>] [--drop-dark]
//                    [--skip <photo-file>]... [--crop <photo-file>=<left>,<top>,<width>,<height>]...
//                    [--closeup <photo-file>=<left>,<top>,<width>,<height>]...
//   npm run insta -- --check <post-notes.md>     scan a finished post-notes file for banned wording
//
// For each photo: BiRefNet cutout, then the piece on a studio template (backdrop, shadow, the shop logo), in
// 4:5 (1080x1350), 1:1 (1080x1080), 9:16 Story (1080x1920) and a full-bleed 4:5 close-up.
// Output goes to instagram/<product-name>/ with a <product-name>_post-notes.md template.
// The jewellery's pixels are never altered: only the background is replaced.
//
// --template auto (the default) rotates through the templates that suit the piece (gold-tone or silver-tone), so
//   each batch looks different. Name one (ivory, gilded-frame, blush-arch, noir, stone, horizon, sage-frame) to pick it.
// The logo is the one uploaded in Settings, or the typeset placeholder until there is one.
// --drop-dark also removes dark, colourless leftovers (black velvet busts and pads). Don't use it on pieces with
//   black stones or black enamel, because it would remove those too.
//
// This script cannot see logos, so look at every photo first:
// --skip leaves out a photo, reported only as "skipped". Use it for any piece with a logo stamped on the jewellery
//   itself, and never write what the mark is anywhere.
// --crop keeps only part of a photo (fractions 0 to 1) before the cutout. Use it to cut away a brand name on a pad,
//   box or card in the background, so it can't survive the cutout.
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

const { scanText, scanHashtag } = await import("../src/lib/claims.ts");

const args = process.argv.slice(2);

if (args[0] === "--check") {
  const file = args[1];
  if (!file) fail("Usage: npm run insta -- --check <post-notes.md>");
  const text = fs.readFileSync(file, "utf8");
  const problems = [...scanText(text), ...(text.match(/#\w+/g) ?? []).flatMap((t) => scanHashtag(t).map((m) => `${t}: ${m}`))];
  if (problems.length) {
    console.log(`Fix before posting (${file}):`);
    for (const p of new Set(problems)) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(`No banned wording found in ${file}.`);
  process.exit(0);
}

const WITH_VALUE = ["--template", "--skip", "--crop", "--closeup", "--variant", "--style"];
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a, i) => !a.startsWith("--") && !WITH_VALUE.includes(args[i - 1]));
const values = (flag: string) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
const [inDir, rawName] = positional;
if (!inDir || !rawName) fail("Usage: npm run insta -- <photo-folder> <product-name> [--template auto|<id>] [--drop-dark] [--skip <file>] [--crop <file>=l,t,w,h]");
const templateArg = values("--template")[0] ?? "auto";
const skip = new Set(values("--skip").map((f) => path.basename(f).toLowerCase()));
const boxes = (flag: string) =>
  new Map(
    values(flag).map((v) => {
      const [file, box] = v.split("=");
      const nums = (box ?? "").split(",").map(Number);
      if (nums.length !== 4 || nums.some((x) => !(x >= 0 && x <= 1))) fail(`${flag} ${v}: use <file>=left,top,width,height as fractions from 0 to 1`);
      return [path.basename(file).toLowerCase(), nums as [number, number, number, number]];
    })
  );
const crops = boxes("--crop");
// The close-up's window as fractions of the cut-out piece, for when the automatic pick misses.
const closeups = boxes("--closeup");

const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outDir = path.resolve(process.env.EFJ_INSTA_DIR || "instagram", slug); // EFJ_INSTA_DIR: write somewhere else, e.g. for a test run
const photos = fs
  .readdirSync(inDir)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort()
  .filter((f) => !skip.has(f.toLowerCase()))
  .map((f) => path.join(inDir, f));
if (skip.size) console.log(`${skip.size} photo(s) skipped.`);
if (!photos.length) fail(`No .jpg, .png or .webp photos to use in ${inDir}. (HEIC can't be read: export as JPG.)`);

async function loadPhoto(file: string): Promise<Buffer> {
  const input = fs.readFileSync(file);
  const c = crops.get(path.basename(file).toLowerCase());
  if (!c) return input;
  const img = sharp(input).rotate(); // honour the phone's orientation before measuring
  const m = await sharp(await img.toBuffer()).metadata();
  const left = Math.round(c[0] * m.width!), top = Math.round(c[1] * m.height!);
  const width = Math.min(m.width! - left, Math.round(c[2] * m.width!)), height = Math.min(m.height! - top, Math.round(c[3] * m.height!));
  return sharp(input).rotate().extract({ left, top, width, height }).jpeg({ quality: 95 }).toBuffer();
}

const { isolatedCutout, localModelPath } = await import("../src/lib/localCutout.ts");
const { logoPng } = await import("../src/lib/brand.ts");
if (!localModelPath()) fail("No local cutout model installed. Run: node scripts/get-birefnet.mjs lite");

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------- templates
// Each batch gets the next template that suits the piece's tone, so the grid keeps changing. One product keeps one
// template across all its images, so a carousel looks like a set. The logo is the owner's (Settings) or the placeholder.

type Tone = "gold" | "silver";
type LogoAt = "bottom" | "top" | "bottom-right" | "top-left";
interface Template {
  id: string;
  label: string;
  tones: Tone[];
  /** SVG drawn under the piece: background and any frame or shape. */
  scene: (w: number, h: number) => string;
  logo: { at: LogoAt; ink: "dark" | "light" };
  shadow: { opacity: number; tint: string };
}

const grad = (w: number, h: number, top: string, bottom: string, glow = "#ffffff", glowOpacity = 0.55) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
  <radialGradient id="r" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="${glow}" stop-opacity="${glowOpacity}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#r)"/>`;
const frame = (w: number, h: number, colour: string, inset = 34) =>
  `<rect x="${inset}" y="${inset}" width="${w - 2 * inset}" height="${h - 2 * inset}" fill="none" stroke="${colour}" stroke-width="2.5"/>
  <rect x="${inset + 9}" y="${inset + 9}" width="${w - 2 * inset - 18}" height="${h - 2 * inset - 18}" fill="none" stroke="${colour}" stroke-width="1" opacity=".7"/>`;

const TEMPLATES: Template[] = [
  {
    id: "ivory",
    label: "Ivory studio",
    tones: ["gold"],
    scene: (w, h) => grad(w, h, "#f6f1ea", "#e7ddd0"),
    logo: { at: "bottom", ink: "dark" },
    shadow: { opacity: 0.28, tint: "#6b5a45" },
  },
  {
    id: "gilded-frame",
    label: "Ivory with a fine gold frame",
    tones: ["gold"],
    scene: (w, h) => grad(w, h, "#faf6f0", "#efe6da") + frame(w, h, "#b8934a"),
    logo: { at: "top", ink: "dark" },
    shadow: { opacity: 0.25, tint: "#6b5a45" },
  },
  {
    id: "blush-arch",
    label: "Blush with a soft arch",
    tones: ["gold"],
    scene: (w, h) => {
      const aw = w * 0.74, ax = (w - aw) / 2, top = h * 0.12, bottom = h * 0.9;
      return grad(w, h, "#f3e4de", "#e6d0c8", "#fff6f2", 0.4) +
        `<path d="M${ax} ${bottom} V${top + aw / 2} A${aw / 2} ${aw / 2} 0 0 1 ${ax + aw} ${top + aw / 2} V${bottom} Z" fill="#fbf2ee" opacity=".85"/>`;
    },
    logo: { at: "bottom", ink: "dark" },
    shadow: { opacity: 0.25, tint: "#7a5a50" },
  },
  {
    id: "noir",
    label: "Deep charcoal",
    tones: ["gold", "silver"],
    scene: (w, h) => grad(w, h, "#2e2a27", "#1b1917", "#6b5d4f", 0.45),
    logo: { at: "bottom", ink: "light" },
    shadow: { opacity: 0.55, tint: "#000000" },
  },
  {
    id: "stone",
    label: "Warm stone grey",
    tones: ["silver"],
    scene: (w, h) => grad(w, h, "#e9e6e2", "#c9c3bc"),
    logo: { at: "bottom-right", ink: "dark" },
    shadow: { opacity: 0.35, tint: "#3f3a35" },
  },
  {
    id: "horizon",
    label: "Tabletop horizon",
    tones: ["silver", "gold"],
    scene: (w, h) =>
      `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d3cc"/><stop offset="1" stop-color="#c4bcb3"/></linearGradient>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1eeea"/><stop offset="1" stop-color="#e4dfd9"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#wall)"/><rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="url(#t)"/>
      <rect y="${h * 0.62}" width="${w}" height="3" fill="#ffffff" opacity=".6"/>`,
    logo: { at: "top-left", ink: "dark" },
    shadow: { opacity: 0.35, tint: "#3f3a35" },
  },
  {
    id: "sage-frame",
    label: "Soft sage with a silver frame",
    tones: ["silver"],
    scene: (w, h) => grad(w, h, "#e8ebe6", "#d3d8d1") + frame(w, h, "#9aa39a"),
    logo: { at: "top", ink: "dark" },
    shadow: { opacity: 0.3, tint: "#3a403a" },
  },
];

const ROTATION_FILE = path.resolve(process.env.EFJ_INSTA_DIR || "instagram", ".template-rotation.json");

/** Next template for this tone, remembered between runs so batches don't repeat back to back. */
function nextTemplate(tone: Tone): Template {
  let state: Record<string, number> = {};
  try { state = JSON.parse(fs.readFileSync(ROTATION_FILE, "utf8")); } catch { /* first run */ }
  const list = TEMPLATES.filter((t) => t.tones.includes(tone));
  const i = (state[tone] ?? 0) % list.length;
  state[tone] = i + 1;
  fs.mkdirSync(path.dirname(ROTATION_FILE), { recursive: true });
  fs.writeFileSync(ROTATION_FILE, JSON.stringify(state, null, 2));
  return list[i];
}

/** Clean the cutout: clear the model's faint haze, optionally drop dark colourless velvet, and trim to the piece. */
async function clean(png: Buffer, dropDark: boolean): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (dropDark) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) data[i + 3] = Math.round(data[i + 3] * Math.min(1, Math.max(0, (L - 140) / 30)));
    }
    if (data[i + 3] < 24) data[i + 3] = 0;
  }
  const flat = await sharp(data, { raw: info }).png().toBuffer();
  return sharp(flat).trim({ threshold: 1 }).png().toBuffer();
}

/** Silver-tone pieces read as colourless: average saturation of the kept pixels decides. */
async function toneOf(cut: Buffer): Promise<Tone> {
  const { data } = await sharp(cut).resize(200, 200, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mx > 40) { sum += (mx - mn) / mx; n++; }
  }
  return n && sum / n < 0.12 ? "silver" : "gold";
}

type Frac4 = [number, number, number, number];
interface Shot {
  W: number;
  H: number;
  /** Area the piece is fitted into, as fractions of the canvas: left, top, width, height. Leaves room for the logo. */
  box: Frac4;
  /** Where the logo's band sits, as a fraction of the height (its vertical centre), for top and bottom logos. */
  logoTop: number;
  logoBottom: number;
  /** Part of the trimmed cutout to use, as fractions: left, top, width, height. */
  crop?: Frac4;
}

const SHOTS: Record<string, Shot> = {
  "4x5_1080x1350": { W: 1080, H: 1350, box: [0.1, 0.13, 0.8, 0.74], logoTop: 0.07, logoBottom: 0.93 },
  "1x1_1080x1080": { W: 1080, H: 1080, box: [0.1, 0.14, 0.8, 0.72], logoTop: 0.075, logoBottom: 0.925 },
  // Middle of the frame only: Instagram covers the top and bottom of a Story with the profile bar and reply box.
  "story_9x16_1080x1920": { W: 1080, H: 1920, box: [0.08, 0.24, 0.84, 0.52], logoTop: 0.18, logoBottom: 0.82 },
  // The busiest part of the piece (crop set per photo by detailCrop), run edge to edge so cut-off parts leave the frame.
  "closeup_4x5_1080x1350": { W: 1080, H: 1350, box: [0, 0.14, 1, 0.72], logoTop: 0.07, logoBottom: 0.93 },
};

async function logoLayer(t: Template, shot: Shot): Promise<{ input: Buffer; left: number; top: number }> {
  const { W, H } = shot;
  const corner = t.logo.at === "bottom-right" || t.logo.at === "top-left";
  const width = Math.round(W * (corner ? 0.2 : 0.26));
  const png = await sharp(await logoPng(t.logo.ink)).resize({ width, height: Math.round(H * 0.07), fit: "inside" }).png().toBuffer();
  const m = await sharp(png).metadata();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * 0.9);
  const input = await sharp(data, { raw: info }).png().toBuffer();
  const band = t.logo.at.startsWith("top") ? shot.logoTop : shot.logoBottom;
  const top = Math.round(band * H - m.height! / 2);
  const margin = Math.round(W * 0.07);
  const left = t.logo.at === "bottom-right" ? W - margin - m.width! : t.logo.at === "top-left" ? margin : Math.round((W - m.width!) / 2);
  return { input, left, top };
}

/** Which sides of a cropped piece still have jewellery on their outermost row or column. */
async function slicedEdges(png: Buffer) {
  const { data, info } = await sharp(png).extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const row = (y: number) => { let s = 0; for (let x = 0; x < w; x++) s += data[y * w + x]; return s / w > 2; };
  const col = (x: number) => { let s = 0; for (let y = 0; y < h; y++) s += data[y * w + x]; return s / h > 2; };
  return { top: row(0), bottom: row(h - 1), left: col(0), right: col(w - 1) };
}

async function render(cut: Buffer, shot: Shot, t: Template, file: string) {
  const { W, H, box, crop } = shot;
  let src = cut;
  if (crop) {
    const m = await sharp(cut).metadata();
    const l = Math.round(crop[0] * m.width!), tp = Math.round(crop[1] * m.height!);
    src = await sharp(cut)
      .extract({ left: l, top: tp, width: Math.min(m.width! - l, Math.round(crop[2] * m.width!)), height: Math.min(m.height! - tp, Math.round(crop[3] * m.height!)) })
      .png()
      .toBuffer();
    src = await sharp(src).trim({ threshold: 1 }).png().toBuffer(); // drop empty margins inside the window
  }
  const m = await sharp(src).metadata();
  const bw = box[2] * W, bh = box[3] * H;
  // Never enlarge more than 2.2x: past that the photo goes soft.
  const k = Math.min(bw / m.width!, bh / m.height!, 2.2);
  const w = Math.round(m.width! * k), h = Math.round(m.height! * k);
  let left = Math.round(box[0] * W + (bw - w) / 2), top = Math.round(box[1] * H + (bh - h) / 2);
  if (crop) {
    // Where the window sliced through the piece, run that side out of the frame so nothing ends in mid-air.
    const e = await slicedEdges(src);
    if (e.left && !e.right) left = 0;
    if (e.right && !e.left) left = W - w;
    // Up or down only away from the logo, so the piece never runs under it.
    const logoOnTop = t.logo.at.startsWith("top");
    if (e.top && !e.bottom && !logoOnTop) top = 0;
    if (e.bottom && !e.top && logoOnTop) top = H - h;
  }
  const piece = await sharp(src).resize(w, h, { kernel: "lanczos3" }).png().toBuffer();

  // Soft shadow from the piece's own outline, laid on an oversized sheet so a full-bleed piece still fits.
  const pad = 40;
  const alpha = await sharp(piece).extractChannel("alpha").toBuffer();
  const tinted = await sharp({ create: { width: w, height: h, channels: 3, background: t.shadow.tint } }).joinChannel(alpha).png().toBuffer();
  const blurred = await sharp(tinted)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(4, w / 70))
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < blurred.data.length; i += 4) blurred.data[i] = Math.round(blurred.data[i] * t.shadow.opacity);
  const shadow = await sharp(blurred.data, { raw: blurred.info }).png().toBuffer();
  const sheet = await sharp({ create: { width: W + 2 * pad, height: H + 2 * pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, left: Math.max(0, left + Math.round(w / 160)), top: Math.max(0, top + Math.round(h / 60)) }])
    .png()
    .toBuffer();
  const shadowLayer = await sharp(sheet).extract({ left: pad, top: pad, width: W, height: H }).png().toBuffer();

  const scene = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${t.scene(W, H)}</svg>`;
  await sharp(Buffer.from(scene))
    .composite([{ input: shadowLayer, left: 0, top: 0 }, { input: piece, left, top }, await logoLayer(t, shot)])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toFile(path.join(outDir, file));
  return file;
}

/**
 * Window for the close-up: the one holding the most of the piece while cutting through the least of it at its edges,
 * so it lands on the clovers of a necklace or the stone-set end of a bangle rather than a stretch of plain chain.
 */
async function detailCrop(cut: Buffer): Promise<Frac4> {
  const G = 60;
  const { data } = await sharp(cut).extractChannel("alpha").resize(G, G, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[y * G + x];
  let best = -Infinity, pick: Frac4 = [0.25, 0.25, 0.5, 0.5];
  for (const [fx, fy] of [[0.5, 0.5], [0.6, 0.5], [0.7, 0.5], [0.6, 0.6]]) {
    const ww = Math.round(G * fx), wh = Math.round(G * fy);
    for (let y = 0; y + wh <= G; y++)
      for (let x = 0; x + ww <= G; x++) {
        let inside = 0, cut = 0;
        for (let j = y; j < y + wh; j++) for (let i = x; i < x + ww; i++) inside += at(i, j);
        // Pixels on the window's edge that are not also on the picture's edge would be sliced in half.
        for (let i = x; i < x + ww; i++) { if (y > 0) cut += at(i, y); if (y + wh < G) cut += at(i, y + wh - 1); }
        for (let j = y; j < y + wh; j++) { if (x > 0) cut += at(x, j); if (x + ww < G) cut += at(x + ww - 1, j); }
        const score = inside / (ww * wh) - (2 * cut) / (2 * (ww + wh));
        if (score > best) { best = score; pick = [x / G, y / G, fx, fy]; }
      }
  }
  return pick;
}

/** Share of the kept pixels that are dark and colourless: a lot of it usually means a velvet bust or pad came along. */
async function darkShare(cut: Buffer): Promise<number> {
  const { data } = await sharp(cut).resize(200, 200, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    n++;
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    if (mx < 70 && mx - Math.min(data[i], data[i + 1], data[i + 2]) < 25) dark++;
  }
  return n ? dark / n : 0;
}

// Cut out every photo first, so the template can be chosen once for the whole product.
fs.mkdirSync(outDir, { recursive: true });
const cuts: { photo: string; cut: Buffer; coverage: number; velvet: boolean }[] = [];
for (const [i, photo] of photos.entries()) {
  process.stdout.write(`Photo ${i + 1}/${photos.length} ${path.basename(photo)}: cutting out... `);
  // Cutouts are kept in .cutouts/, so running again with another template takes seconds instead of minutes.
  const input = await loadPhoto(photo);
  const cacheFile = path.join(outDir, ".cutouts", createHash("sha256").update(input).digest("hex").slice(0, 16) + ".json");
  let r: { png: Buffer; coverage: number; ms: number };
  if (fs.existsSync(cacheFile)) {
    const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    r = { png: Buffer.from(c.png, "base64"), coverage: c.coverage, ms: 0 };
  } else {
    // Each photo in its own process: memory is freed between photos, and running out of it gives a clear message.
    try {
      r = await isolatedCutout(input);
    } catch (e) {
      fail(`
${e instanceof Error ? e.message : String(e)}`);
    }
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ png: r.png.toString("base64"), coverage: r.coverage }));
  }
  const cut = await clean(r.png, flags.has("--drop-dark"));
  const velvet = !flags.has("--drop-dark") && (await darkShare(cut)) > 0.15;
  cuts.push({ photo: path.basename(photo), cut, coverage: r.coverage, velvet });
  console.log(`${Math.round(r.ms / 1000)} s, kept ${(r.coverage * 100).toFixed(0)}%`);
}

let template: Template;
if (templateArg && templateArg !== "auto") {
  template = TEMPLATES.find((t) => t.id === templateArg) ?? fail(`Unknown template "${templateArg}". Use one of: ${TEMPLATES.map((t) => t.id).join(", ")}`);
} else {
  const tones = await Promise.all(cuts.map((c) => toneOf(c.cut)));
  template = nextTemplate(tones.filter((t) => t === "silver").length > tones.length / 2 ? "silver" : "gold");
}
console.log(`Template: ${template.label} (${template.id})`);

// --variant <name> --style <json>: a second set of the same images, laid out as an art director chose (the Instagram page
// asks Claude). Only the placement changes: where the piece sits, how big, the shadow, and where the close-up looks. The
// cut-out pixels are used as they are. Files are named <slug>_<n>_<variant>_<size>.jpg.
const variant = values("--variant")[0]?.replace(/[^a-z]/g, "") || "";
const style = (() => {
  const raw = values("--style")[0];
  if (!raw) return null;
  const s = JSON.parse(raw) as { layout?: string; zoom?: number; shadow?: string; focus?: { x: number; y: number } };
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    layout: s.layout === "slightly-low" || s.layout === "diagonal" ? s.layout : "centred",
    zoom: clamp(s.zoom, 0.7, 1, 1),
    shadow: s.shadow === "light" ? "light" : "soft",
    focus: s.focus ? { x: clamp(s.focus.x, 0, 1, 0.5), y: clamp(s.focus.y, 0, 1, 0.5) } : null,
  };
})();
if (style) {
  console.log(`Style: ${style.layout}, zoom ${style.zoom}, ${style.shadow} shadow${style.focus ? ", close-up focus set" : ""}`);
  if (style.shadow === "light") template = { ...template, shadow: { ...template.shadow, opacity: template.shadow.opacity * 0.6 } };
}

/** The piece's area for a styled shot: scaled around its centre, then moved for the layout. Close-ups stay edge to edge. */
function styledShot(shot: Shot, closeup: boolean): Shot {
  if (!style || closeup) return shot;
  const [l, t, w, h] = shot.box;
  const nw = w * style.zoom, nh = h * style.zoom;
  let nl = l + (w - nw) / 2, nt = t + (h - nh) / 2;
  if (style.layout === "slightly-low") nt = Math.min(t + h - nh, nt + h * 0.06);
  if (style.layout === "diagonal") { nl = Math.max(l, nl - w * 0.06); nt = Math.max(t, nt - h * 0.04); }
  return { ...shot, box: [nl, nt, nw, nh] };
}

/** A close-up window of half the piece, centred on the chosen point and kept inside the piece. */
const focusCrop = (f: { x: number; y: number }): Frac4 => [Math.min(0.5, Math.max(0, f.x - 0.25)), Math.min(0.5, Math.max(0, f.y - 0.25)), 0.5, 0.5];

const made: { photo: string; files: string[]; coverage: number; velvet: boolean }[] = [];
for (const [i, c] of cuts.entries()) {
  const files: string[] = [];
  for (const [size, shot] of Object.entries(SHOTS)) {
    const closeup = size.startsWith("closeup");
    const crop = closeup ? closeups.get(c.photo.toLowerCase()) ?? (style?.focus ? focusCrop(style.focus) : await detailCrop(c.cut)) : undefined;
    const s = styledShot(closeup ? { ...shot, crop } : shot, closeup);
    files.push(await render(c.cut, s, template, `${slug}_${i + 1}_${variant ? `${variant}_` : ""}${size}.jpg`));
  }
  made.push({ photo: c.photo, files, coverage: c.coverage, velvet: c.velvet });
}

const notesFile = path.join(outDir, `${slug}_post-notes.md`);
if (fs.existsSync(notesFile)) {
  console.log(`Kept your existing ${path.basename(notesFile)}.`);
} else {
  const title = rawName.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const rows = made.flatMap((m, i) => m.files.map((f) => `| \`${f}\` | Photo ${i + 1} (${m.photo}), ${f.includes("story") ? "Story" : f.includes("1x1") ? "square post" : f.includes("closeup") ? "close-up slide" : "feed / carousel slide"} |`));
  fs.writeFileSync(
    notesFile,
    `# ${title}: Instagram post

Studio images made on this computer with the Studio's BiRefNet cutout. Only the background was replaced; the
jewellery was not recoloured, reshaped or retouched.

## Before posting
- [ ] No brand name or logo shows anywhere in the images, and none is written in this file.
- [ ] The cutout edges look clean on every image (chains, clasps, stones).
- [ ] Every [BRACKET] below is filled in or removed.
- [ ] \`npm run insta -- --check ${path.relative(process.cwd(), notesFile).replace(/\\/g, "/")}\` passes.

## Images

| File | Use |
|---|---|
${rows.join("\n")}

## Product info

- **What it is:** [DESCRIBE THE PIECE]
- **Finish:** [10K gold-plated, or the confirmed material for silver-tone pieces]
- **Size / length:** [CONFIRM]
- **Price:** $[PRICE] CAD
- **How to order:** [ORDER CTA]
- **Care:** keep it dry, take it off before showering, swimming or the gym, and store it in a pouch.

## Caption

> [HOOK LINE] ✨
>
> [ONE OR TWO LINES ON THE PIECE AND HOW TO WEAR IT]
>
> $[PRICE] CAD. [ORDER CTA]

## Hashtags

\`\`\`
#ElegantFashionJewellery #vancouverjewellery #shopsmallyvr #yvrstyle [PRODUCT TAGS]
\`\`\`

## Alt text

- **Slide 1:** [WHAT THE PIECE LOOKS LIKE, ITS COLOURS AND THE BACKGROUND]

## When to post

Tuesday to Thursday, 11 am to 1 pm or 7 to 9 pm Pacific.
`
  );
  console.log(`Wrote ${path.basename(notesFile)} (a template: fill in the brackets).`);
}
console.log(`\nDone: ${made.length * Object.keys(SHOTS).length} images in ${outDir}`);
for (const m of made) {
  if (m.coverage < 0.02 || m.coverage > 0.9) console.log(`Check ${m.photo}: the cutout kept ${(m.coverage * 100).toFixed(0)}% of the picture, which usually means it missed.`);
  if (m.velvet) console.log(`Check ${m.photo}: part of a dark display (velvet bust or pad) seems to be left in. If the piece has no black stones or enamel, run again with --drop-dark.`);
}
