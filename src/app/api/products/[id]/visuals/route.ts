import { NextResponse } from "next/server";
import { z } from "zod";
import { getImage, getProduct, listImages } from "@/lib/db";
import { SourceError, makeVisual, type VisualRequest } from "@/lib/visuals";
import { isLook } from "@/lib/looks";
import { FORMATS } from "@/lib/posters";
import { SCENES, SKIN_TONES, posesFor } from "@/lib/presets";

export const runtime = "nodejs";
export const maxDuration = 180;

const has = (o: object, k: string) => Object.hasOwn(o, k);
const photoId = z.number().int().positive();

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enhance"), sourceImageId: photoId }),
  z.object({ kind: z.literal("clean"), sourceImageId: photoId }),
  z.object({ kind: z.literal("cutout"), sourceImageId: photoId }),
  z.object({
    kind: z.literal("studio"),
    sourceImageId: photoId,
    look: z.string().refine(isLook, "Unknown look."),
    format: z.string().refine((f) => has(FORMATS, f), "Unknown size.").optional(),
    logo: z.boolean({ error: "logo must be true or false." }).optional(),
  }),
  z.object({
    kind: z.literal("scene"),
    preset: z.string().refine((p) => SCENES.some((s) => s.id === p), "Unknown scene."),
    mode: z.enum(["natural", "safe"], { error: "Unknown scene mode." }).optional(),
  }),
  z.object({
    kind: z.literal("on_model"),
    preset: z.string(),
    skin: z.string().refine((s) => SKIN_TONES.some((t) => t.id === s), "Unknown pose or skin tone."),
  }),
  z.object({ kind: z.literal("scale") }),
], { error: "Unknown kind." });

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Creates ONE new image. The studio calls this once per requested scene/pose so progress is visible. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) return bad("Not found", 404);

  const raw = await req.json().catch(() => undefined);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Invalid request.");
  const body = parsed.data as VisualRequest;

  // Poses depend on the product (rings get hand poses, necklaces neck poses).
  if (body.kind === "on_model" && !posesFor(product.category, product.gender).some((p) => p.id === body.preset)) {
    return bad("Unknown pose or skin tone.");
  }
  // Cut-outs, clean backgrounds, studio shots and touch-ups start only from the owner's own original photos.
  if ("sourceImageId" in body) {
    const src = getImage(body.sourceImageId);
    if (!src || src.product_id !== id) return bad("Photo not found.", 404);
    if (src.kind !== "original") return bad("Only your own original photos can be used here, not generated or edited pictures.");
  }

  try {
    const imageId = await makeVisual(product, listImages(id), body);
    return NextResponse.json({ imageId, image: getImage(imageId) }, { status: 201 });
  } catch (e) {
    if (e instanceof SourceError) return bad(e.message);
    const msg = e instanceof Error ? e.message : "Image generation failed";
    return bad(msg, 502);
  }
}
