import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR } from "./db";

/**
 * The shop's logo, used as a small mark on finished pictures. Until the owner uploads their own (Settings), a simple
 * typeset placeholder is drawn by code. An uploaded logo replaces it everywhere.
 */

const BRAND_DIR = path.join(DATA_DIR, "brand");
const CUSTOM_LOGO = path.join(BRAND_DIR, "logo.png");
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** "dark" ink for light backgrounds, "light" ink for dark backgrounds. */
import type { LogoInk } from "./looks";
export type { LogoInk };
const INK: Record<LogoInk, string> = { dark: "#a8823a", light: "#ecd49a" };

function placeholderSvg(ink: string) {
  return `<svg width="1400" height="420" xmlns="http://www.w3.org/2000/svg">
  <path d="M700 22 L724 54 L700 86 L676 54 Z" fill="none" stroke="${ink}" stroke-width="6"/>
  <text x="700" y="250" text-anchor="middle" fill="${ink}" font-family="Georgia, 'Times New Roman', serif" font-size="170" letter-spacing="34">ELEGANT</text>
  <line x1="390" y1="292" x2="1010" y2="292" stroke="${ink}" stroke-width="3"/>
  <text x="700" y="380" text-anchor="middle" fill="${ink}" font-family="'Segoe UI', Arial, sans-serif" font-size="62" letter-spacing="24">FASHION JEWELLERY</text>
</svg>`;
}

const placeholderCache = new Map<LogoInk, Buffer>();
let lightCache: { mtime: number; png: Buffer } | null = null;

export async function hasCustomLogo(): Promise<boolean> {
  try {
    await fs.access(CUSTOM_LOGO);
    return true;
  } catch {
    return false;
  }
}

/** The logo as a transparent PNG, trimmed to its contents. */
export async function logoPng(ink: LogoInk = "dark"): Promise<Buffer> {
  if (await hasCustomLogo()) {
    const own = await fs.readFile(CUSTOM_LOGO);
    if (ink === "dark") return own;
    const mtime = (await fs.stat(CUSTOM_LOGO)).mtimeMs;
    if (lightCache?.mtime !== mtime) lightCache = { mtime, png: await lightened(own) };
    return lightCache.png;
  }
  const hit = placeholderCache.get(ink);
  if (hit) return hit;
  const png = await sharp(await sharp(Buffer.from(placeholderSvg(INK[ink]))).png().toBuffer()).trim().png().toBuffer();
  placeholderCache.set(ink, png);
  return png;
}

/**
 * A dark logo would vanish on the dark backdrop, so it is redrawn in the light gold ink there (same shape, from the
 * logo's own transparency). Light or colourful logos are left as they are.
 */
async function lightened(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    sum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    weight += a;
  }
  if (!weight || sum / weight / 255 > 0.45) return png;
  const alpha = await sharp(png).ensureAlpha().extractChannel(3).toBuffer();
  return sharp({ create: { width: info.width, height: info.height, channels: 3, background: INK.light } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

export class LogoError extends Error {}

/** Stores the owner's logo (PNG, JPG or WebP; transparent PNG works best), trimmed and at most 1200px. */
export async function saveCustomLogo(buf: Buffer): Promise<Buffer> {
  if (buf.length > MAX_LOGO_BYTES) throw new LogoError("The logo file is larger than 5 MB.");
  // 40 megapixels is far more than any logo needs and stops a tiny file that unpacks into a huge image.
  const open = () => sharp(buf, { limitInputPixels: 40_000_000 });
  let meta;
  try {
    meta = await open().metadata();
  } catch {
    throw new LogoError("That file is not a readable image.");
  }
  if (!["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new LogoError("Use a PNG, JPG or WebP logo (a transparent PNG works best).");
  let png: Buffer;
  try {
    png = await open()
      .rotate()
      .ensureAlpha()
      .trim()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    // trim() fails on a blank image; a damaged file fails here too.
    throw new LogoError("Could not use that image. Check it is not blank or damaged.");
  }
  const { channels } = await sharp(png).stats();
  if ((channels[3]?.max ?? 255) === 0) throw new LogoError("That logo is completely transparent, so nothing would show.");
  await fs.mkdir(BRAND_DIR, { recursive: true });
  await fs.writeFile(CUSTOM_LOGO, png);
  return png;
}

export async function removeCustomLogo() {
  await fs.rm(CUSTOM_LOGO, { force: true });
}

/** Places the logo small, centred near the bottom edge, slightly transparent. */
export async function withLogo(img: Buffer, W: number, H: number, ink: LogoInk): Promise<Buffer> {
  const logo = await logoPng(ink);
  const mark = await sharp(logo)
    .resize({ width: Math.round(W * 0.26), height: Math.round(H * 0.055), fit: "inside" })
    .ensureAlpha()
    .linear([1, 1, 1, 0.9], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const m = await sharp(mark).metadata();
  return sharp(img)
    .composite([{ input: mark, left: Math.round((W - (m.width ?? 0)) / 2), top: Math.round(H - H * 0.035 - (m.height ?? 0)) }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
