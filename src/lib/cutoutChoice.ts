import sharp from "sharp";

/**
 * Two cutouts of the same photo can disagree about what "the piece" is:
 *   BiRefNet cuts out the whole object it finds, so a necklace on a black display bust comes out with the bust, and a ring
 *   comes out with the hand wearing it. Its edges are clean and it fills gaps on polished or dark engraved metal.
 *   The built-in colour method keeps only the gold, so the piece comes out alone, but it can leave holes where polished or
 *   dark metal does not look gold.
 *
 * Measured on the owner's own photos (share of the picture kept, BiRefNet divided by colour method):
 *   Tiffany-engraved bangle 1.2x and 1.2x      same object: BiRefNet is better (no holes)
 *   logo set on a bust      3.7x, 21.6x, 26.3x BiRefNet kept the bust: the colour method gives the jewellery alone
 * so anything above this ratio means BiRefNet has kept a lot more than the metal.
 */
export const STAND_RATIO = 2;

/**
 * The share of a cutout's picture that is kept (opaque), from 0 to 1. Counts the transparency channel's pixels directly:
 * sharp's stats() ignores a channel extraction and would report a colour channel of the photo instead.
 */
export async function alphaShare(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let kept = 0;
  for (const v of data) if (v > 128) kept++;
  return data.length ? kept / data.length : 0;
}

export type CutoutPick = "birefnet" | "gold";

export function pickCutout(birefnetShare: number, goldShare: number): CutoutPick {
  // No usable gold result: nothing to compare with.
  if (!(goldShare > 0)) return "birefnet";
  if (!(birefnetShare > 0)) return "gold";
  return birefnetShare / goldShare > STAND_RATIO ? "gold" : "birefnet";
}
