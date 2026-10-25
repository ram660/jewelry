import sharp from "sharp";

/**
 * Local, key-free background removal for GOLD-coloured jewellery.
 *
 * It finds the jewellery by colour (gold hue, reasonably saturated), so it keeps your real pixels
 * and costs nothing. It works best on gold pieces photographed against a plain or dark display
 * (velvet bust, tray, white card). It cannot find silver, rose gold or clear stones on their own:
 * clear stones that sit inside the gold are kept (see fillBrightHoles), everything else needs the
 * hosted cutout model (fal.ai BiRefNet).
 */

export class CutoutError extends Error {}

export interface CutoutResult {
  /** RGBA PNG: your original pixels, transparent everywhere that is not jewellery. */
  png: Buffer;
  width: number;
  height: number;
  /** Share of the photo covered by jewellery, 0..1. */
  coverage: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Hue (deg), saturation and value (both 0..1). */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

/** 0..1: how gold is this pixel. Full strength for hues 26..54 degrees, fading out over 14 degrees. */
export function goldScore(r: number, g: number, b: number): number {
  const [h, s, v] = hsv(r, g, b);
  const hue = 1 - smooth(0, 14, Math.max(0, Math.abs(h - 40) - 14));
  return hue * smooth(0.18, 0.4, s) * smooth(0.1, 0.26, v);
}

type Mask = Uint8Array;

function maxFilter(m: Mask, w: number, h: number, r: number): Mask {
  const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && m[y * w + xx]) v = 1; }
      t[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x]) v = 1; }
      o[y * w + x] = v;
    }
  }
  return o;
}
const invert = (m: Mask): Mask => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
const minFilter = (m: Mask, w: number, h: number, r: number): Mask => invert(maxFilter(invert(m), w, h, r));

/** 8-connected components of the 1s in a mask. */
function components(m: Mask, w: number, h: number) {
  const lab = new Int32Array(m.length), sizes: number[] = [0], stack = new Int32Array(m.length);
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    n++;
    let sp = 0, size = 0;
    stack[sp++] = i;
    lab[i] = n;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (m[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
      }
    }
    sizes.push(size);
  }
  return { lab, sizes, n };
}

/**
 * Clear stones are not gold-coloured, so they show up as holes inside the gold. Holes that are BRIGHT
 * (stone, shine) are filled; holes that are DARK (the velvet or backdrop showing through an open design)
 * stay transparent, as they should.
 */
function fillBrightHoles(mask: Mask, value: Float32Array, satur: Float32Array, w: number, h: number): Mask {
  const inv = invert(mask);
  const { lab, sizes, n } = components(inv, w, h);
  const border = new Set<number>();
  for (let x = 0; x < w; x++) { border.add(lab[x]); border.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { border.add(lab[y * w]); border.add(lab[y * w + w - 1]); }

  const sumV = new Float64Array(n + 1), sumS = new Float64Array(n + 1);
  for (let i = 0; i < inv.length; i++) if (inv[i]) { sumV[lab[i]] += value[i]; sumS[lab[i]] += satur[i]; }

  const out = new Uint8Array(mask);
  const maxHole = w * h * 0.004; // a stone, not a gap between two pieces
  for (let i = 0; i < inv.length; i++) {
    const l = lab[i];
    if (!inv[i] || border.has(l) || sizes[l] > maxHole) continue;
    // A stone is bright AND nearly colourless. A tinted bright hole is most likely the room showing through.
    if (sumV[l] / sizes[l] > 0.6 && sumS[l] / sizes[l] < 0.12) out[i] = 1;
  }
  return out;
}

/**
 * Hysteresis: a weak gold pixel (thin chain, shaded metal) is kept only if it connects to a STRONG gold
 * blob. Strong blobs must be a sensible size, which removes specks; weak pixels near them survive, which
 * keeps hair-thin chains that a single threshold would shred.
 */
function hysteresis(score: Float32Array, w: number, h: number, minStrong: number): Mask {
  const N = w * h;
  const weak = new Uint8Array(N), strong = new Uint8Array(N);
  for (let i = 0; i < N; i++) { weak[i] = score[i] > 0.2 ? 1 : 0; strong[i] = score[i] > 0.5 ? 1 : 0; }

  // Bridge small gaps (2-3 px) when deciding what is connected, but keep the original weak pixels as the result.
  const bridged = maxFilter(weak, w, h, 2);
  const { lab, sizes, n } = components(bridged, w, h);
  const strongCount = new Int32Array(n + 1);
  for (let i = 0; i < N; i++) if (strong[i]) strongCount[lab[i]]++;

  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const l = lab[i];
    if (weak[i] && l && strongCount[l] >= minStrong && sizes[l] >= minStrong) out[i] = 1;
  }
  return out;
}

export async function goldCutout(input: Buffer, maxSide = 1600): Promise<CutoutResult> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const N = w * h;

  const score = new Float32Array(N), value = new Float32Array(N), satur = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    score[i] = goldScore(r, g, b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    value[i] = mx / 255;
    satur[i] = mx ? (mx - mn) / mx : 0;
  }

  // Keep gold that is part of a real piece (strong blob of sensible size, plus weak pixels attached to it).
  const keep = hysteresis(score, w, h, Math.max(40, Math.round(N * 0.00004)));

  // Close tiny gaps (chain links, shine) without closing real openings.
  let mask = minFilter(maxFilter(keep, w, h, 2), w, h, 2);
  mask = fillBrightHoles(mask, value, satur, w, h);

  // Trim the dark halo: edge pixels that are almost black are velvet, not metal.
  const inner = minFilter(mask, w, h, 1);
  for (let i = 0; i < N; i++) if (mask[i] && !inner[i] && value[i] < 0.3) mask[i] = 0;

  let covered = 0;
  for (let i = 0; i < N; i++) covered += mask[i];
  const coverage = covered / N;
  if (coverage < 0.0008) {
    throw new CutoutError("Couldn't find gold jewellery in this photo by colour. It may be silver or rose gold, or the photo is too dark or blurry.");
  }
  if (coverage > 0.35) {
    throw new CutoutError("Too much of this photo looks gold-coloured (a gold or beige background?). Try a plainer or darker background.");
  }

  // Soft edge: blur the mask a touch so the cutout does not look cut with scissors.
  const alphaRaw = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } })
    .blur(0.7)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ach = alphaRaw.info.channels;

  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = alphaRaw.data[i * ach];
  }
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { png, width: w, height: h, coverage };
}

// ---------------------------------------------------------------- plain-background cutout

/**
 * Local, key-free background removal for ANY metal (silver, rose gold, stones) photographed on a PLAIN backdrop
 * (white card, grey board, black velvet without a room behind it). It reads the backdrop colour from the edges of the
 * photo and removes everything that matches it, keeping your real pixels. It cannot handle a busy background.
 */

const SRGB_LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/** CIE Lab per pixel: distances in Lab follow how different two colours look to people. */
function labOf(data: Buffer, N: number) {
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  for (let i = 0; i < N; i++) {
    const r = SRGB_LIN[data[i * 3]], g = SRGB_LIN[data[i * 3 + 1]], b = SRGB_LIN[data[i * 3 + 2]];
    const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return { L, A, B };
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
};

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

async function loadRgb(input: Buffer, maxSide: number) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Original pixels + a soft-edged alpha made from the mask. */
async function maskToPng(data: Buffer, mask: Mask, w: number, h: number): Promise<Buffer> {
  const N = w * h;
  const alphaRaw = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } })
    .blur(0.7)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ach = alphaRaw.info.channels;
  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = alphaRaw.data[i * ach];
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

export async function plainCutout(input: Buffer, maxSide = 1600): Promise<CutoutResult> {
  const { data, w, h } = await loadRgb(input, maxSide);
  const N = w * h;
  const { L, A, B } = labOf(data, N);

  // 1. The backdrop colour = the typical colour of a thin band around the edge of the photo.
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.02));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
    }
  }
  const bl = median(border.map((i) => L[i])), ba = median(border.map((i) => A[i])), bb = median(border.map((i) => B[i]));
  const dBg = (i: number) => Math.hypot(L[i] - bl, A[i] - ba, B[i] - bb);
  let near = 0;
  for (const i of border) if (dBg(i) < 18) near++;
  if (near / border.length < 0.8) {
    throw new CutoutError("The background isn't plain (the edges of the photo show more than one colour). Use a plain white, grey or black backdrop that fills the frame.");
  }

  // 2. Edge strength per pixel: the colour change ACROSS it (left vs right, above vs below). Smooth light falloff
  //    and soft shadows are near 0; the outline of the metal is high even where anti-aliasing softens it into small
  //    steps, which a plain "close to my neighbour" rule would walk straight through.
  //    Known limit: where light silver is within ~5 lightness units of a white card there is no usable edge, and
  //    that part of the piece is lost. For silver, a grey or black backdrop works much better.
  const dE = (i: number, j: number) => Math.hypot(L[i] - L[j], A[i] - A[j], B[i] - B[j]);
  const edge = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      edge[i] = Math.max(dE(i - 1, i + 1), dE(i - w, i + w));
    }
  }

  // 3. Grow the backdrop inwards from the edges of the photo. A pixel joins if it is close to the backdrop colour,
  //    close to its neighbour, and not on an edge.
  // G caps how far from the backdrop colour the growth may drift (uneven lighting vs. eating a light piece).
  const G = 18, NEIGHBOUR = 6, EDGE = 8, LOCAL = 6;
  const bg = new Uint8Array(N), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const push = (i: number) => { bg[i] = 1; queue[qt++] = i; };
  const grow = () => {
    while (qh < qt) {
      const p = queue[qh++];
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of DIRS4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (bg[q]) continue;
        if (dBg(q) < G && edge[q] < EDGE && dE(q, p) < NEIGHBOUR) push(q);
      }
    }
  };
  for (const i of border) if (!bg[i] && dBg(i) < G) push(i);
  grow();

  // 4. Openings inside the piece (the middle of a ring) don't touch the edge of the photo. A flat, enclosed area
  //    counts as an opening when its colour matches the backdrop RIGHT AROUND IT. Comparing with the backdrop at the
  //    photo's edges is not enough: with uneven light the edges are darker and can match a light part of the metal.
  const flat = new Uint8Array(N);
  for (let i = 0; i < N; i++) flat[i] = !bg[i] && edge[i] < EDGE ? 1 : 0;
  const fl = components(flat, w, h);
  const minHole = Math.max(30, Math.round(N * 0.0003));
  const n = fl.n;
  const sumL = new Float64Array(n + 1), sumA = new Float64Array(n + 1), sumB = new Float64Array(n + 1);
  const x0 = new Int32Array(n + 1).fill(w), y0 = new Int32Array(n + 1).fill(h), x1 = new Int32Array(n + 1), y1 = new Int32Array(n + 1);
  for (let i = 0; i < N; i++) {
    const c = fl.lab[i];
    if (!c || fl.sizes[c] < minHole) continue;
    sumL[c] += L[i]; sumA[c] += A[i]; sumB[c] += B[i];
    const x = i % w, y = (i / w) | 0;
    if (x < x0[c]) x0[c] = x;
    if (x > x1[c]) x1[c] = x;
    if (y < y0[c]) y0[c] = y;
    if (y > y1[c]) y1[c] = y;
  }
  const pad = Math.max(20, Math.round(Math.min(w, h) * 0.05));
  const holes = new Set<number>();
  for (let c = 1; c <= n; c++) {
    const size = fl.sizes[c];
    if (size < minHole) continue;
    const mL = sumL[c] / size, mA = sumA[c] / size, mB = sumB[c] / size;
    // Mean colour of the already-found backdrop in a margin around this area.
    let k = 0, lL = 0, lA = 0, lB = 0;
    const ya = Math.max(0, y0[c] - pad), yb = Math.min(h - 1, y1[c] + pad), xa = Math.max(0, x0[c] - pad), xb = Math.min(w - 1, x1[c] + pad);
    for (let y = ya; y <= yb; y += 2) {
      for (let x = xa; x <= xb; x += 2) {
        const i = y * w + x;
        if (bg[i]) { k++; lL += L[i]; lA += A[i]; lB += B[i]; }
      }
    }
    if (k < 50) continue;
    const local = Math.hypot(mL - lL / k, mA - lA / k, mB - lB / k);
    if (local < LOCAL && Math.hypot(mL - bl, mA - ba, mB - bb) < G) holes.add(c);
  }
  for (let i = 0; i < N; i++) if (holes.has(fl.lab[i])) push(i);
  grow();

  // 5. Everything else is the piece; drop dust and specks.
  const mask = invert(bg);
  const fc = components(mask, w, h);
  const minSize = Math.max(40, Math.round(N * 0.00004));
  for (let i = 0; i < N; i++) if (mask[i] && fc.sizes[fc.lab[i]] < minSize) mask[i] = 0;

  let covered = 0;
  for (let i = 0; i < N; i++) covered += mask[i];
  const coverage = covered / N;
  if (coverage < 0.0008) throw new CutoutError("Couldn't find the jewellery against the background.");
  if (coverage > 0.6) throw new CutoutError("Most of the photo looks like it isn't background: it may not be plain enough.");

  return { png: await maskToPng(data, mask, w, h), width: w, height: h, coverage };
}

export type CutoutMethod = "gold" | "plain";

/**
 * Tries the gold-colour method first (works on busy rooms and display busts), then the plain-background method
 * (works for silver, rose gold and stones on a plain backdrop). Both keep the real pixels; neither uses AI.
 */
export async function localCutout(input: Buffer): Promise<CutoutResult & { method: CutoutMethod }> {
  try {
    return { ...(await goldCutout(input)), method: "gold" };
  } catch (goldErr) {
    if (!(goldErr instanceof CutoutError)) throw goldErr;
    try {
      return { ...(await plainCutout(input)), method: "plain" };
    } catch (plainErr) {
      if (!(plainErr instanceof CutoutError)) throw plainErr;
      throw new CutoutError(`${goldErr.message} The plain-background method didn't work either: ${plainErr.message}`);
    }
  }
}
