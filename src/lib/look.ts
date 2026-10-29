import sharp from "sharp";
import type { OverlayOptions, Sharp } from "sharp";
import { FORMATS, type FormatId } from "./posters";
import { withLogo } from "./brand";
import { LOOKS, type LookId } from "./looks";
import { gemWeight, labToSrgb, srgbToLab, type Lab } from "./colourMatch";

export { LOOKS, isLook, type LookId } from "./looks";

/**
 * Post-ready "studio shots" made with classic photo editing only (no AI): the same steps a retoucher would do in
 * Photoshop or Lightroom, applied automatically to the transparent cut-out of the owner's own photo, then placed on a
 * backdrop that is drawn by code.
 */

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ measuring the photo

/** Grey-world white balance measured on near-neutral pixels (cloth, wall, card), never on the gold. */
export async function whiteBalanceGains(photo: Buffer): Promise<[number, number, number]> {
  const { data } = await sharp(photo).rotate().resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 3) {
    const R = data[i], G = data[i + 1], B = data[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx > 90 && mx < 250 && (mx - mn) / mx < 0.2) { r += R; g += G; b += B; n++; }
  }
  if (n < 500) return [1, 1, 1];
  const m = (r + g + b) / (3 * n), lim = (x: number) => Math.min(1.2, Math.max(0.85, x));
  return [lim(m / (r / n)), lim(m / (g / n)), lim(m / (b / n))];
}

/** Black and white points of the metal, like "Auto Levels" with clipping, but capped so it stays gentle. */
function levelPoints(rgb: Buffer, gains: number[], alpha: Buffer) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let p = 0, i = 0; i < rgb.length; i += 3, p++) {
    if (alpha[p] < 200) continue;
    hist[clamp(Math.round(0.2126 * rgb[i] * gains[0] + 0.7152 * rgb[i + 1] * gains[1] + 0.0722 * rgb[i + 2] * gains[2]))]++;
    n++;
  }
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.005) { hi = v; break; } }
  return { lo: Math.min(lo, 25), hi: Math.max(hi, 235) };
}

function curveLut(gain: number, lo: number, hi: number, s: number) {
  const lut = new Uint8Array(256);
  for (let c = 0; c < 256; c++) {
    let v = Math.min(1, Math.max(0, (c * gain - lo) / (hi - lo)));
    v = (1 - s) * v + s * (0.5 - 0.5 * Math.cos(Math.PI * v));
    lut[c] = Math.round(v * 255);
  }
  return lut;
}

/** sharp may return several channels for a single-channel operation; always read one value per pixel. */
async function oneChannel(img: Sharp, N: number): Promise<Buffer> {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return data;
  const out = Buffer.alloc(N);
  for (let p = 0; p < N; p++) out[p] = data[p * info.channels];
  return out;
}

// ------------------------------------------------------------------ the retouch

/**
 * The jewellery retouch, on a transparent cut-out (alpha is kept): white balance, gentle levels and curve, clarity
 * (local contrast on lightness only), gold vibrance, sharpening, and a soft sparkle on the brightest highlights.
 * Coloured stones get the lightness changes only, so a red pearl stays the red it was in the photo.
 */
export async function jewelleryLook(cutPng: Buffer, gains: [number, number, number]): Promise<Buffer> {
  const { data: rgba, info } = await sharp(cutPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, N = w * h;
  const rgb = Buffer.alloc(N * 3), alpha = Buffer.alloc(N);
  for (let p = 0; p < N; p++) {
    rgb[p * 3] = rgba[p * 4]; rgb[p * 3 + 1] = rgba[p * 4 + 1]; rgb[p * 3 + 2] = rgba[p * 4 + 2]; alpha[p] = rgba[p * 4 + 3];
  }

  // Coloured stones, pearls and enamel keep their own colour (white balance only); the retouch below is tuned for gold.
  const gem = new Float32Array(N);
  const gemLab: Lab[] = new Array(N);
  for (let p = 0; p < N; p++) {
    if (alpha[p] < 8) continue;
    const c = srgbToLab(clamp(rgb[p * 3] * gains[0]), clamp(rgb[p * 3 + 1] * gains[1]), clamp(rgb[p * 3 + 2] * gains[2]));
    const w = gemWeight(c);
    if (w > 0) { gem[p] = w; gemLab[p] = c; }
  }

  const { lo, hi } = levelPoints(rgb, gains, alpha);
  const luts = gains.map((g) => curveLut(g, lo, hi, 0.15));
  for (let i = 0; i < rgb.length; i += 3) for (let k = 0; k < 3; k++) rgb[i + k] = luts[k][rgb[i + k]];

  const lum = await oneChannel(sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).greyscale(), N);
  const eq = await oneChannel(sharp(lum, { raw: { width: w, height: h, channels: 1 } }).clahe({ width: 48, height: 48, maxSlope: 3 }), N);
  for (let p = 0; p < N; p++) {
    const f = Math.min(1.6, Math.max(0.6, 1 + 0.45 * ((eq[p] + 1) / (lum[p] + 1) - 1)));
    for (let k = 0; k < 3; k++) rgb[p * 3 + k] = clamp(Math.round(rgb[p * 3 + k] * f));
  }

  for (let i = 0; i < rgb.length; i += 3) {
    const R = rgb[i], G = rgb[i + 1], B = rgb[i + 2];
    if (R > G && G > B && R - B > 25) {
      const y = 0.2126 * R + 0.7152 * G + 0.0722 * B, k = 1.14;
      rgb[i] = clamp(Math.round(y + (R - y) * k)); rgb[i + 1] = clamp(Math.round(y + (G - y) * k)); rgb[i + 2] = clamp(Math.round(y + (B - y) * k));
    }
  }

  // Lightness from the retouch (contrast, clarity), colour from the photo.
  for (let p = 0; p < N; p++) {
    const w = gem[p];
    if (!w) continue;
    const now = srgbToLab(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]), was = gemLab[p];
    const [R, G, B] = labToSrgb({ L: now.L, a: now.a + (was.a - now.a) * w, b: now.b + (was.b - now.b) * w });
    rgb[p * 3] = R; rgb[p * 3 + 1] = G; rgb[p * 3 + 2] = B;
  }

  const sharp1 = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).sharpen({ sigma: 1.1, m1: 0.6, m2: 3 }).raw().toBuffer();
  const hl = Buffer.alloc(N * 3);
  for (let p = 0; p < N; p++) {
    const y = 0.2126 * sharp1[p * 3] + 0.7152 * sharp1[p * 3 + 1] + 0.0722 * sharp1[p * 3 + 2];
    if (y > 215 && alpha[p] > 200) for (let k = 0; k < 3; k++) hl[p * 3 + k] = sharp1[p * 3 + k];
  }
  const glow = await sharp(hl, { raw: { width: w, height: h, channels: 3 } }).blur(6).raw().toBuffer();
  const out = Buffer.alloc(N * 4);
  for (let p = 0; p < N; p++) {
    for (let k = 0; k < 3; k++) {
      const a = sharp1[p * 3 + k] / 255, b = (glow[p * 3 + k] / 255) * 0.35;
      out[p * 4 + k] = clamp(Math.round((1 - (1 - a) * (1 - b)) * 255));
    }
    out[p * 4 + 3] = alpha[p];
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// ------------------------------------------------------------------ backdrops (drawn by code, no stock photos)

/** Small seeded random generator, so the linen texture is the same every time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (W: number, H: number, inner: string) =>
  sharp(Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`)).png().toBuffer();

async function backdrop(look: LookId, W: number, H: number, floorY: number): Promise<Buffer> {
  switch (look) {
    case "cream":
      return svg(W, H, `<defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#fcf9f3"/><stop offset="1" stop-color="#e8dfcf"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
    case "gloss":
      return svg(W, H, `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1f0ee"/></linearGradient>
        <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e7e3"/><stop offset="1" stop-color="#fbfaf8"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#w)"/><rect y="${floorY}" width="100%" height="${H - floorY}" fill="url(#f)"/>`);
    case "dark":
      return svg(W, H, `<defs><radialGradient id="d" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#3b3640"/><stop offset=".6" stop-color="#1b191f"/><stop offset="1" stop-color="#0b0a0d"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#d)"/>`);
    case "linen": {
      const rnd = seeded(20261024);
      const fine = Buffer.alloc(W * H), rowN = Buffer.alloc(H), colN = Buffer.alloc(W);
      for (let i = 0; i < fine.length; i++) fine[i] = 128 + Math.round((rnd() - 0.5) * 40);
      for (let i = 0; i < H; i++) rowN[i] = 128 + Math.round((rnd() - 0.5) * 60);
      for (let i = 0; i < W; i++) colN[i] = 128 + Math.round((rnd() - 0.5) * 60);
      const rows = await sharp(rowN, { raw: { width: 1, height: H, channels: 1 } }).resize(W, H, { kernel: "nearest" }).raw().toBuffer();
      const cols = await sharp(colN, { raw: { width: W, height: 1, channels: 1 } }).resize(W, H, { kernel: "nearest" }).raw().toBuffer();
      const fineB = await oneChannel(sharp(fine, { raw: { width: W, height: H, channels: 1 } }).blur(0.6), W * H);
      const rgb = Buffer.alloc(W * H * 3);
      for (let p = 0; p < W * H; p++) {
        const t = (fineB[p] - 128) * 0.25 + (rows[p] - 128) * 0.15 + (cols[p] - 128) * 0.15;
        const cx = (p % W) / W - 0.5, cy = Math.floor(p / W) / H - 0.42;
        const vig = 1 - 0.18 * Math.min(1, (cx * cx + cy * cy) * 2.2);
        rgb[p * 3] = clamp(Math.round((236 + t) * vig)); rgb[p * 3 + 1] = clamp(Math.round((227 + t) * vig)); rgb[p * 3 + 2] = clamp(Math.round((212 + t) * vig));
      }
      return sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    }
  }
}

async function trimmed(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("The cut-out is empty.");
  return sharp(png).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

/** Mirror reflection on a glossy surface: flipped and faded out. */
async function reflectionOf(prodPng: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(prodPng).flip().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const keep = Math.round(info.height * 0.45);
  for (let y = 0; y < info.height; y++) {
    const f = y < keep ? 0.3 * (1 - y / keep) : 0;
    for (let x = 0; x < info.width; x++) data[(y * info.width + x) * 4 + 3] = Math.round(data[(y * info.width + x) * 4 + 3] * f);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).blur(1.2).png().toBuffer();
}

// How much of the frame the jewellery may use, per size (with a reflection it sits higher and smaller).
const LAYOUT: Record<FormatId, { box: number; boxRefl: number; floor: number }> = {
  post: { box: 0.7, boxRefl: 0.52, floor: 0.66 },
  square: { box: 0.72, boxRefl: 0.56, floor: 0.7 },
  story: { box: 0.6, boxRefl: 0.46, floor: 0.62 },
};

/** Places the retouched cut-out on the chosen backdrop at the chosen Instagram size, with an optional logo. */
export async function renderStudio(lookPng: Buffer, look: LookId, format: FormatId, logo: boolean): Promise<Buffer> {
  const { w: W, h: H } = FORMATS[format];
  const L = LAYOUT[format], spec = LOOKS[look];
  const prodFull = await trimmed(lookPng);
  const m = await sharp(prodFull).metadata();
  const s = Math.min((W * 0.8) / (m.width ?? 1), (H * (spec.reflection ? L.boxRefl : L.box)) / (m.height ?? 1));
  const pw = Math.max(1, Math.round((m.width ?? 1) * s)), ph = Math.max(1, Math.round((m.height ?? 1) * s));
  const prod = await sharp(prodFull).resize(pw, ph).png().toBuffer();
  const left = Math.round((W - pw) / 2);
  const top = spec.reflection ? Math.round(H * L.floor - ph) : Math.round((H * (logo ? 0.94 : 1) - ph) / 2);

  const layers: OverlayOptions[] = [];
  if (spec.reflection) {
    const refl = await reflectionOf(prod);
    const rm = await sharp(refl).metadata();
    const rh = Math.min(rm.height ?? 0, H - (top + ph));
    if (rh > 0) layers.push({ input: await sharp(refl).extract({ left: 0, top: 0, width: rm.width ?? pw, height: rh }).png().toBuffer(), left, top: top + ph });
  }
  layers.push({ input: prod, left, top });
  const img = await sharp(await backdrop(look, W, H, top + ph)).composite(layers).jpeg({ quality: 92 }).toBuffer();
  return logo ? withLogo(img, W, H, spec.ink) : img;
}
