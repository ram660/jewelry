import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
import { DATA_DIR, addImage, nextSortOrder, type NewImage } from "./db";

// resolve, not join: a relative EFJ_DATA_DIR would otherwise make every path check fail.
export const UPLOAD_DIR = path.resolve(DATA_DIR, "uploads");
export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Saves a full-size JPEG (max 2000px) and a 600px WebP thumbnail. Returns paths relative to UPLOAD_DIR. */
export async function saveImage(buf: Buffer, productId: number) {
  const dir = path.join(UPLOAD_DIR, String(productId));
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = `${productId}/${id}.jpg`;
  const thumb = `${productId}/${id}-t.webp`;

  const base = sharp(buf).rotate(); // honour phone EXIF orientation
  await base
    .clone()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toFile(path.join(UPLOAD_DIR, file));
  await base
    .clone()
    .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(UPLOAD_DIR, thumb));
  return { file, thumb };
}

/**
 * Saves a transparent cut-out: a full-size PNG (max 2000px) and a 600px WebP thumbnail, both keeping the alpha
 * channel. Used for posters and for downloading into other design tools.
 */
export async function saveCutout(png: Buffer, productId: number) {
  const dir = path.join(UPLOAD_DIR, String(productId));
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = `${productId}/${id}.png`;
  const thumb = `${productId}/${id}-t.webp`;
  const base = sharp(png).ensureAlpha();
  await base
    .clone()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(UPLOAD_DIR, file));
  await base
    .clone()
    .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, alphaQuality: 90 })
    .toFile(path.join(UPLOAD_DIR, thumb));
  return { file, thumb };
}

/** Shrinks any image to a JPEG that fits in max x max. Keeps requests to AI hosts small and fast. */
export async function toModelJpeg(buf: Buffer, max = 1280): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Saves uploaded files as images of a product. Throws if any file is not a readable image. */
export async function ingestFiles(productId: number, files: File[], o: NewImage = {}) {
  // Check every size before reading any file, so nothing is half-saved.
  const big = files.find((f) => f.size > MAX_PHOTO_BYTES);
  if (big) throw new Error(`${big.name || "a photo"} is larger than 25 MB`);
  let order = nextSortOrder(productId);
  const ids: number[] = [];
  for (const f of files) {
    const { file, thumb } = await saveImage(Buffer.from(await f.arrayBuffer()), productId);
    ids.push(addImage(productId, file, thumb, order++, o));
  }
  return ids;
}

export async function removeFiles(...rel: string[]) {
  await Promise.all(rel.map((r) => fs.rm(uploadPath(r), { force: true })));
}

/** Full path of a stored image. Throws if a stored path would point outside the uploads folder. */
export function uploadPath(rel: string): string {
  const full = safeResolve(rel);
  if (!full) throw new Error("Invalid image path.");
  return full;
}

export async function removeProductDir(productId: number) {
  await fs.rm(path.join(UPLOAD_DIR, String(productId)), { recursive: true, force: true });
}

/** Resolves a relative path inside UPLOAD_DIR, or null if it tries to escape it. */
export function safeResolve(rel: string): string | null {
  const full = path.resolve(UPLOAD_DIR, rel);
  return full.startsWith(UPLOAD_DIR + path.sep) ? full : null;
}
