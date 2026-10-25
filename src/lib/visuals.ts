import fs from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import {
  activeImageModel, backdropModel, cutoutMode, cutoutModel, cutoutResolution, cutoutVariant, editModel, falConfigured,
  imageProvider, visionProvider,
} from "./config";
import { localCutout as birefnetCutout, localCutoutAvailable } from "./localCutout";
import { alphaShare, pickCutout } from "./cutoutChoice";
import { CANVAS, compositeProduct, creamBackdrop } from "./composite";
import { CutoutError, localCutout } from "./cutout";
import { falDownload, falRun, type FalImages } from "./providers/fal";
import { geminiImage } from "./providers/gemini";
import { askVision } from "./providers/vision";
import { parseJsonLoose } from "./json";
import { addImage, nextSortOrder } from "./db";
import { saveCutout, saveImage, toModelJpeg, uploadPath } from "./storage";
import { SCALE_PRESET, SCENES, SCENE_BACKDROP, SKIN_TONES, posesFor, type Preset } from "./presets";
import type { Product, ProductImage } from "./types";
import { LOOKS, jewelleryLook, renderStudio, whiteBalanceGains, type LookId } from "./look";
import { FORMATS, type FormatId } from "./posters";

export type VisualRequest =
  | { kind: "enhance"; sourceImageId: number }
  | { kind: "clean"; sourceImageId: number }
  | { kind: "cutout"; sourceImageId: number }
  | { kind: "studio"; sourceImageId: number; look: LookId; format?: FormatId; logo?: boolean }
  | { kind: "scene"; preset: string; mode?: "natural" | "safe" }
  | { kind: "on_model"; preset: string; skin: string }
  | { kind: "scale" };

const readImage = (img: ProductImage) => fs.readFile(uploadPath(img.path));
const dataUri = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;

/** Fidelity scores under this are flagged in red. The owner can still approve after looking. */
export const FIDELITY_MIN = Number(process.env.FIDELITY_MIN) || 75;

// 4:5 portrait, both sides multiples of 64 as image models prefer.
const SIZE = { width: 1024, height: 1280 };

// ---------------------------------------------------------------- prompts

const FIDELITY_RULES = `CRITICAL: the reference photos show ONE real piece of jewellery. Reproduce that exact piece: same overall shape, the same number, size and placement of stones, the same chain-link pattern, clasp, thickness, finish and gold tone. Do not add, remove, simplify or redesign anything on the jewellery. Keep it in sharp focus and clearly the hero of the image.
Style: photorealistic, premium e-commerce / Instagram photography, soft natural light, elegant and uncluttered, portrait 4:5. No text, no watermark, no logo, no extra jewellery.`;

const NEGATIVE = "text, watermark, logo, extra jewellery, extra rings, deformed, distorted, blurry, low quality, cartoon";

function buildPrompt(p: Product, scene: string): string {
  return `Create a photograph of this ${p.category === "other" ? "piece of jewellery" : p.category} (${p.colour_finish || "gold-plated"}${p.stones ? `, ${p.stones}` : ""}), ${scene}.\n\n${FIDELITY_RULES}`;
}

function resolvePreset(req: VisualRequest, p: Product): { preset: Preset; prompt: string; label: string } {
  if (req.kind === "scene") {
    const preset = SCENES.find((s) => s.id === req.preset);
    if (!preset) throw new Error(`Unknown scene “${req.preset}”.`);
    return { preset, prompt: buildPrompt(p, preset.prompt), label: preset.label };
  }
  if (req.kind === "on_model") {
    const preset = posesFor(p.category, p.gender).find((s) => s.id === req.preset);
    const skin = SKIN_TONES.find((s) => s.id === req.skin);
    if (!preset || !skin) throw new Error("Unknown pose or skin tone.");
    return {
      preset,
      prompt: buildPrompt(p, `shown on ${skin.prompt}: ${preset.prompt}`),
      label: `${preset.label} (${skin.label})`,
    };
  }
  if (req.kind === "scale") {
    return { preset: SCALE_PRESET, prompt: buildPrompt(p, SCALE_PRESET.prompt), label: SCALE_PRESET.label };
  }
  throw new Error("Unsupported request.");
}

// ---------------------------------------------------------------- generation

/** Gentle touch-up: a small lift in contrast, brightness, saturation and sharpness. */
async function enhance(buf: Buffer) {
  return sharp(buf)
    .rotate()
    .normalise({ lower: 1, upper: 99 })
    .modulate({ brightness: 1.02, saturation: 1.04 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** No fal key: put the real photo on a coloured backdrop so the whole workflow can be tried. */
async function demoComposite(buf: Buffer, preset: Preset) {
  const photo = await sharp(buf).rotate().resize(880, 880, { fit: "inside" }).toBuffer();
  return sharp({ create: { ...CANVAS, channels: 3, background: preset.demo } })
    .composite([{ input: photo, gravity: "center" }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Result images from fal: the first image, unless the safety checker blanked it. */
async function firstImage(out: FalImages): Promise<Buffer> {
  if (out.has_nsfw_concepts?.[0]) {
    throw new Error("The host's safety filter blocked this image (it sometimes misfires on skin). Try again or pick another pose.");
  }
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("The image model returned no image.");
  return falDownload(url);
}

/** Natural mode: the editing model re-draws the scene around your reference photos. */
async function generateEdit(prompt: string, refs: Buffer[]): Promise<Buffer> {
  if (imageProvider() === "gemini") {
    const jpegs = await Promise.all(refs.map((b) => toModelJpeg(b, 1280)));
    return sharp(await geminiImage(prompt, jpegs)).jpeg({ quality: 92 }).toBuffer();
  }
  const image_urls = await Promise.all(refs.map(async (b) => dataUri(await toModelJpeg(b, 1280))));
  const out = await falRun<FalImages>(editModel(), {
    prompt,
    image_urls,
    image_size: SIZE,
    output_format: "jpeg",
    num_images: 1,
    negative_prompt: NEGATIVE,
  });
  return sharp(await firstImage(out)).jpeg({ quality: 92 }).toBuffer();
}

// ---- safe mode: real pixels



/** fal.ai BiRefNet: a general-purpose cutout (any metal, stones, any background). */
async function falCutout(source: Buffer): Promise<Buffer> {
  const cut = await falRun<{ image?: { url: string } }>(cutoutModel(), {
    image_url: dataUri(await toModelJpeg(source, 2048)),
    model: cutoutVariant(),
    operating_resolution: cutoutResolution(),
    refine_foreground: true,
    output_format: "png",
  });
  if (!cut.image?.url) throw new Error("The cutout model returned no image.");
  const buf = await falDownload(cut.image.url);
  if (!(await sharp(buf).metadata()).hasAlpha) throw new Error("The cutout came back without transparency.");
  return buf;
}

/**
 * Cuts the jewellery out of a photo, keeping the real pixels. The local methods (gold colour, then plain backdrop)
 * are free and need no key; fal.ai's BiRefNet is used when it is the active image provider, or as a fallback when
 * neither local method can find the piece.
 */
async function cutoutFor(source: Buffer): Promise<{ png: Buffer; via: string }> {
  const mode = cutoutMode();
  if (mode === "fal" || (mode === "auto" && imageProvider() === "fal")) return { png: await falCutout(source), via: cutoutModel() };

  const builtIn = async () => {
    const cut = await localCutout(source);
    return { png: cut.png, via: cut.method === "gold" ? "local gold-colour cutout" : "local plain-background cutout" };
  };

  const haveBirefnet = localCutoutAvailable();
  if (mode === "local" && !haveBirefnet) throw new CutoutError("BiRefNet is not installed. Run: node scripts/get-birefnet.mjs lite");

  // BiRefNet on this computer: free, private, works on any metal and on polished or dark engraved surfaces.
  let bire: { png: Buffer; via: string } | null = null;
  if ((mode === "local" || mode === "auto") && haveBirefnet) {
    try {
      const r = await birefnetCutout(source);
      // Almost nothing kept, or almost everything kept: the model did not find the piece.
      if (r.coverage >= 0.005 && r.coverage <= 0.92) bire = { png: r.png, via: r.via };
    } catch (e) {
      if (mode === "local") throw e instanceof CutoutError ? e : new CutoutError(e instanceof Error ? e.message : "The local cutout failed.");
      // In auto mode the built-in method below still gets a go.
    }
    if (mode === "local") {
      if (!bire) throw new CutoutError("The cutout could not find the piece in this photo. Try a plainer background.");
      return bire;
    }
  }

  // The built-in colour method keeps the metal alone. When both exist, BiRefNet is used unless it kept far more than the
  // metal (a display bust, a hand): then the jewellery alone is what is wanted. See cutoutChoice.ts for the measurements.
  let gold: { png: Buffer; via: string } | null = null;
  let goldError: unknown = null;
  if (mode !== "local") {
    try { gold = await builtIn(); } catch (e) { goldError = e; }
  }
  if (bire && gold) {
    return pickCutout(await alphaShare(bire.png), await alphaShare(gold.png)) === "gold" ? gold : bire;
  }
  if (bire) return bire;
  if (gold) return gold;
  if (goldError instanceof CutoutError && mode !== "gold" && falConfigured()) return { png: await falCutout(source), via: cutoutModel() };
  throw goldError;
}

/** An EMPTY backdrop picture (no jewellery in it), from whichever image provider is active. */
async function backdropFor(prompt: string): Promise<{ buf: Buffer; via: string }> {
  if (imageProvider() === "fal") {
    const bd = await falRun<FalImages>(backdropModel(), {
      prompt,
      image_size: SIZE,
      num_inference_steps: 4,
      num_images: 1,
      output_format: "jpeg",
    });
    return { buf: await firstImage(bd), via: backdropModel() };
  }
  // Text only, no reference photos: nothing for the model to change on your jewellery.
  return { buf: await geminiImage(prompt, []), via: activeImageModel() };
}

/** Safe mode: your real product pixels on an AI-made backdrop. */
async function generateSafeScene(
  source: Buffer, sceneId: string, category: string
): Promise<{ buf: Buffer; prompt: string; via: string }> {
  const backdropDesc = SCENE_BACKDROP[sceneId];
  if (!backdropDesc) throw new Error("This scene has no safe-mode backdrop.");

  const cut = await cutoutFor(source);
  const prompt = `Empty product-photography backdrop: ${backdropDesc}. Nothing on the surface: no jewellery, no objects, no people, no text. Clear open space in the centre of the frame. Photorealistic, portrait 4:5.`;
  const bd = await backdropFor(prompt);
  // Things that hang (chains, necklaces, sets) should not cast a ground shadow.
  const hangs = ["chain", "necklace", "set"].includes(category);
  return { buf: await compositeProduct(cut.png, bd.buf, { shadow: !hangs }), prompt, via: `${cut.via} + ${bd.via}` };
}

/** Clean background: your real jewellery on a plain cream studio backdrop. No AI picture is made. */
async function cleanShot(source: Buffer): Promise<{ buf: Buffer; png: Buffer; via: string }> {
  const cut = await cutoutFor(source);
  const buf = await compositeProduct(cut.png, await creamBackdrop(), { maxW: 920, maxH: 1120, centerY: 675, shadow: false });
  return { buf, png: cut.png, via: cut.via };
}

const isLocalCut = (via: string) => via.startsWith("local ");
const aiCutNote = (via: string) => (isLocalCut(via) ? "" : ` The background was found by an AI model (${via}): check it before approving.`);

/** Only the owner's own original photos may be cut out, retouched or cleaned: never an AI picture. */
export class SourceError extends Error {}
function ownOriginal(images: ProductImage[], id: number): ProductImage {
  const src = images.find((i) => i.id === id);
  if (!src) throw new SourceError("Photo not found.");
  if (src.kind !== "original") throw new SourceError("Only your own original photos can be used here, not generated or edited pictures.");
  return src;
}

async function storeCutout(p: Product, png: Buffer, via: string, sourceId: number): Promise<number> {
  const saved = await saveCutout(png, p.id);
  const local = isLocalCut(via);
  return addImage(p.id, saved.file, saved.thumb, nextSortOrder(p.id), {
    kind: "cutout",
    // A local cut-out only masks the owner's photo, so it is usable at once (design asset, never a slide by itself).
    // One found by an AI model waits for the owner's approval like any other AI output.
    approved: local,
    label: "Transparent cut-out",
    model_used: via,
    fidelity_notes: local
      ? "Your own photo with a see-through background; nothing generated. Check the edges before using it in a poster or Canva."
      : `Your own photo with a see-through background.${aiCutNote(via)}`,
    source_image_id: sourceId,
  });
}

// ---------------------------------------------------------------- fidelity check

const Fidelity = z.object({
  score: z.number().min(0).max(100).catch(0),
  issues: z.array(z.string()).catch([]),
});

/** Asks a vision model to compare the real photos with the generated one and score how faithfully the piece was kept. */
async function fidelityCheck(originals: Buffer[], generated: Buffer) {
  if (!visionProvider()) {
    return { score: null, notes: "Add an AI key to get an automatic match score. Compare with your original by eye." };
  }
  const prompt = `The first ${originals.length} image(s) are REAL photos of one piece of jewellery. The last image is an AI-generated picture that should show the SAME piece.
Compare only the jewellery itself (ignore background, hands, lighting). Check: overall shape, number and placement of stones, chain/link pattern, clasp or band style, thickness, colour and gold tone, and that nothing was added or removed.
Reply with ONLY JSON: {"score": 0-100 (100 = identical piece), "issues": ["short, specific differences; empty if none"]}`;
  try {
    const photos = await Promise.all([...originals, generated].map((b) => toModelJpeg(b, 1024)));
    const parsed = Fidelity.parse(parseJsonLoose(await askVision(prompt, photos, { temperature: 0, maxTokens: 1500 })));
    return { score: Math.round(parsed.score), notes: parsed.issues.join("; ") || "No differences found." };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 140) : "unknown error";
    return { score: null, notes: `The automatic check could not run (${why}). Compare with your original by eye.` };
  }
}

// ---------------------------------------------------------------- entry point

export async function makeVisual(p: Product, images: ProductImage[], req: VisualRequest): Promise<number> {
  const originals = images.filter((i) => i.kind === "original");
  if (!originals.length) throw new Error("Add at least one original photo first.");

  // Enhancing is local image processing: needs no key.
  if (req.kind === "enhance") {
    const src = ownOriginal(images, req.sourceImageId);
    const saved = await saveImage(await enhance(await readImage(src)), p.id);
    return addImage(p.id, saved.file, saved.thumb, nextSortOrder(p.id), {
      kind: "enhanced",
      approved: false,
      label: "Touched up",
      model_used: "sharp",
      fidelity_notes:
        "Your own photo with contrast, brightness, colour and sharpness adjusted; nothing generated. Colour and shine are " +
        "enhanced, so check it against the piece in daylight.",
      source_image_id: src.id,
    });
  }

  // Clean background is local too: it works even in demo mode, with no key.
  if (req.kind === "clean") {
    const src = ownOriginal(images, req.sourceImageId);
    const r = await cleanShot(await readImage(src));
    const saved = await saveImage(r.buf, p.id);
    const cleanId = addImage(p.id, saved.file, saved.thumb, nextSortOrder(p.id), {
      kind: "clean",
      approved: false,
      label: "Clean background",
      model_used: r.via,
      fidelity_notes: `No new pixels generated: the background was removed from your own photo.${aiCutNote(r.via)} Zoom in and check the edges and the chain.`,
      source_image_id: src.id,
    });
    // Keep the transparent version too, for posters.
    await storeCutout(p, r.png, r.via, src.id);
    return cleanId;
  }

  // Post-ready studio shot, no AI: classic retouch of the real pixels on a code-drawn backdrop.
  if (req.kind === "studio") {
    const src = ownOriginal(images, req.sourceImageId);
    const photo = await readImage(src);
    // Reuse this photo's saved cut-out if there is one; otherwise make it now and keep it (posters use it too).
    const saved = images.find((i) => i.kind === "cutout" && i.source_image_id === src.id);
    let cutPng: Buffer, via: string;
    if (saved) {
      cutPng = await fs.readFile(uploadPath(saved.path));
      via = saved.model_used ?? "local cutout";
    } else {
      const cut = await cutoutFor(photo);
      cutPng = cut.png;
      via = cut.via;
      await storeCutout(p, cut.png, cut.via, src.id);
    }
    // The piece ends up at most ~860px wide on the post: retouching more pixels only costs time and memory.
    cutPng = await sharp(cutPng).resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const format = req.format ?? "post";
    const retouched = await jewelleryLook(cutPng, await whiteBalanceGains(photo));
    const out = await renderStudio(retouched, req.look, format, req.logo !== false);
    const file = await saveImage(out, p.id);
    return addImage(p.id, file.file, file.thumb, nextSortOrder(p.id), {
      kind: "studio",
      approved: false,
      label: `${LOOKS[req.look].label} · ${FORMATS[format].label}`,
      model_used: isLocalCut(via) ? "code (no AI)" : `code retouch; cut-out by ${via}`,
      fidelity_notes:
        "Retouched from your own photo (no generated pixels): white balance, contrast, gold vibrance, sharpening and a " +
        `highlight glow, on a drawn backdrop. Colour and shine are enhanced, so check it still matches the piece in daylight.${aiCutNote(via)}`,
      source_image_id: src.id,
    });
  }

  // Transparent cut-out only (for photos that already have a clean-background version).
  if (req.kind === "cutout") {
    const src = ownOriginal(images, req.sourceImageId);
    const cut = await cutoutFor(await readImage(src));
    return storeCutout(p, cut.png, cut.via, src.id);
  }

  const { preset, prompt, label } = resolvePreset(req, p);
  // Up to 3 originals as references: more angles help the model keep the design right.
  const refImages = originals.slice(0, 3);
  const refs = await Promise.all(refImages.map(readImage));
  const safe = req.kind === "scene" && req.mode === "safe";

  let buf: Buffer;
  let model: string;
  let usedPrompt = prompt;
  let outLabel = label;
  let fidelity: { score: number | null; notes: string | null } = { score: null, notes: null };

  if (!imageProvider()) {
    buf = await demoComposite(refs[0], preset);
    model = "demo";
    fidelity = { score: null, notes: "Demo mode: your real photo on a placeholder backdrop. Add an AI key for real images." };
  } else if (safe) {
    const r = await generateSafeScene(refs[0], req.preset, p.category);
    buf = r.buf;
    usedPrompt = r.prompt;
    model = r.via;
    outLabel = `${label} · real product`;
    fidelity = { score: null, notes: `Your jewellery is cut out of your own photo (not redrawn); the backdrop is AI-made. Edges, shadow and colour can shift slightly, so check it against the piece.${r.via.startsWith("local ") ? "" : " The outline was found by an AI model."}` };
  } else {
    buf = await generateEdit(prompt, refs);
    model = activeImageModel();
    fidelity = await fidelityCheck(refs, buf);
  }

  const saved = await saveImage(buf, p.id);
  return addImage(p.id, saved.file, saved.thumb, nextSortOrder(p.id), {
    kind: req.kind,
    approved: false,
    label: outLabel,
    prompt_used: usedPrompt,
    model_used: model,
    fidelity_score: fidelity.score,
    fidelity_notes: fidelity.notes,
    source_image_id: refImages[0].id,
  });
}
