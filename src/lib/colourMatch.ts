/**
 * Colour comparison between the jewellery in a real photo and in an AI picture. Pure maths, no Node imports.
 * Works on cut-outs (RGBA, background transparent), so background, crop and pose do not matter. Brightness is left
 * out on purpose: a new scene has new lighting. Only the tone of the piece (how yellow, rosy or pale it is) is compared.
 */

export interface Lab { L: number; a: number; b: number }

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** sRGB (0-255) to CIELAB, D65 white. */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const toByte = (v: number) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};

/** CIELAB (D65) back to sRGB 0-255, clipped to what a screen can show. */
export function labToSrgb({ L, a, b }: Lab): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  return [
    toByte(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    toByte(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    toByte(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
}

/**
 * How much a pixel looks like a coloured stone, pearl, bead or enamel rather than gold or a neutral (silver, white
 * stones, shadow): 0 to 1. Gold sits around hue 60-100 in Lab; anything clearly coloured outside that counts.
 */
export function gemWeight(c: Lab): number {
  const C = Math.hypot(c.a, c.b);
  const colourful = Math.min(1, Math.max(0, (C - 12) / 10));
  if (!colourful) return 0;
  const h = (deg(Math.atan2(c.b, c.a)) + 360) % 360;
  const fromGold = h < 62 ? 62 - h : h > 98 ? h - 98 : 0;
  return colourful * Math.min(1, fromGold / 10);
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 colour difference. About 1 is the smallest difference people notice side by side. */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const C1 = Math.hypot(c1.a, c1.b), C2 = Math.hypot(c2.a, c2.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * c1.a, a2 = (1 + G) * c2.a;
  const C1p = Math.hypot(a1, c1.b), C2p = Math.hypot(a2, c2.b);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = hue(c1.b, a1), h2 = hue(c2.b, a2);

  const dL = c2.L - c1.L;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));

  const Lm = (c1.L + c2.L) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) > 180) hm += h1 + h2 < 360 ? 360 : -360;
    hm /= 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) -
    0.2 * Math.cos(rad(4 * hm - 63));
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cmp;
  const SH = 1 + 0.015 * Cmp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Typical colour of the visible piece in an RGBA buffer: the median L, a and b of pixels that are clearly part of the
 * jewellery. The median ignores bright glints and dark shadows. Null when too little of the piece is visible.
 */
export function maskedMedianLab(rgba: ArrayLike<number>, minAlpha = 200, minPixels = 200, keep?: (c: Lab) => boolean): Lab | null {
  const L: number[] = [], A: number[] = [], B: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < minAlpha) continue;
    const c = srgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (keep && !keep(c)) continue;
    L.push(c.L); A.push(c.a); B.push(c.b);
  }
  if (L.length < minPixels) return null;
  return { L: median(L), a: median(A), b: median(B) };
}

/**
 * Tone difference with brightness ignored. Dimmer light lowers lightness and colour strength together, so the AI
 * picture's colour is scaled up to the photo's lightness before comparing.
 */
export function toneDifference(original: Lab, generated: Lab): number {
  const k = generated.L > 1 ? original.L / generated.L : 1;
  return deltaE2000(original, { L: original.L, a: generated.a * k, b: generated.b * k });
}

export const TONE_CLOSE = 3;
export const TONE_CLEAR = 6;

/** The coloured stones, pearls or beads of a cut-out, for a separate check: in the overall median the gold outvotes them. */
export const gemMedianLab = (rgba: ArrayLike<number>) => maskedMedianLab(rgba, 200, 100, (c) => gemWeight(c) > 0.5);

/** One plain sentence for the owner about how the AI picture's tone compares with the real photo. */
export function describeTone(original: Lab, generated: Lab, part: "piece" | "stones" = "piece"): string {
  const d = toneDifference(original, generated);
  const shown = d.toFixed(1);
  const what = part === "piece" ? "Colour check: the piece's tone" : "Stone colour check: the coloured stones";
  const verb = part === "piece" ? "is" : "are";
  if (d < TONE_CLOSE) return `${what} ${part === "piece" ? "matches" : "match"} your photo (difference ${shown}; under ${TONE_CLOSE} is hard to see).`;
  const ways: string[] = [];
  const da = generated.a - original.a, db = generated.b - original.b;
  if (da > 2) ways.push("rosier");
  else if (da < -2) ways.push("less rosy");
  if (db > 3) ways.push("more yellow");
  else if (db < -3) ways.push("paler, less yellow");
  const how = ways.length ? `, ${ways.join(" and ")}` : "";
  return d < TONE_CLEAR
    ? `${what} ${verb} slightly different from your photo (difference ${shown}${how}). Compare them side by side.`
    : `${what} ${verb} clearly different from your photo (difference ${shown}${how}). The ${part === "piece" ? "gold" : "stone"} colour may have changed.`;
}
