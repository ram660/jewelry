import sharp from "sharp";
import type { OverlayOptions } from "sharp";

/** Instagram portrait 4:5. */
export const CANVAS = { width: 1080, height: 1350 };

export class CompositeError extends Error {}

/** Smallest box containing every pixel that is not (nearly) transparent. */
async function alphaBounds(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, imgW: info.width, imgH: info.height };
}

export interface PlaceOptions {
  /** Largest size the product may take on the canvas. */
  maxW?: number;
  maxH?: number;
  /** Vertical centre of the product on the canvas. */
  centerY?: number;
  /** Soft contact shadow under the product. Wrong for things that hang (necklaces), so it can be turned off. */
  shadow?: boolean;
}

/** Places a transparent cutout of the real product on a backdrop, with a soft contact shadow. */
export async function compositeProduct(cutout: Buffer, backdrop: Buffer, o: PlaceOptions = {}): Promise<Buffer> {
  const { maxW = 760, maxH = 720, centerY = 650, shadow: withShadow = true } = o;

  // Bound the work: scan at most 1600px.
  const small = await sharp(cutout).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const b = await alphaBounds(small);
  if (!b || b.width * b.height < b.imgW * b.imgH * 0.0005) {
    throw new CompositeError("The cutout found no product in the photo. Try a photo with a plainer background.");
  }
  const cropped = await sharp(small).extract({ left: b.left, top: b.top, width: b.width, height: b.height }).toBuffer();

  const scale = Math.min(maxW / b.width, maxH / b.height);
  const pw = Math.max(1, Math.round(b.width * scale));
  const ph = Math.max(1, Math.round(b.height * scale));
  const product = await sharp(cropped).resize(pw, ph).png().toBuffer();
  const left = Math.round((CANVAS.width - pw) / 2);
  const top = Math.round(centerY - ph / 2);

  const layers: OverlayOptions[] = [];
  if (withShadow) {
    const shadowSvg = `<svg width="${CANVAS.width}" height="${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${CANVAS.width / 2}" cy="${top + ph + 4}" rx="${Math.round(pw * 0.42)}" ry="${Math.round(ph * 0.05 + 8)}" fill="black" fill-opacity="0.3"/></svg>`;
    layers.push({ input: await sharp(Buffer.from(shadowSvg)).blur(14).png().toBuffer(), left: 0, top: 0 });
  }
  layers.push({ input: product, left, top });

  const bg = await sharp(backdrop).resize(CANVAS.width, CANVAS.height, { fit: "cover" }).jpeg().toBuffer();
  return sharp(bg).composite(layers).jpeg({ quality: 92 }).toBuffer();
}

/** A soft cream studio backdrop, drawn locally (no AI, no text). */
export async function creamBackdrop(): Promise<Buffer> {
  const svg = `<svg width="${CANVAS.width}" height="${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#faf6ee"/><stop offset="1" stop-color="#e9e0d0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
