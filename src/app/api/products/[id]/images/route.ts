import { NextResponse } from "next/server";
import { z } from "zod";
import { getProduct, listImages } from "@/lib/db";
import { MAX_PHOTOS, ingestFiles } from "@/lib/storage";
import { claimContext, scanText } from "@/lib/claims";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Pictures drawn by code in the browser (no AI): saved straight into the approved library. */
const CODE_DRAWN: Record<string, string> = { price_card: "Info card", poster: "Poster" };
const MAX_LABEL = 80;
const MAX_TEXT = 2000;

const Fields = z.object({
  kind: z.enum(["original", "price_card", "poster"], { error: "Unknown kind." }),
  label: z.string().trim().max(MAX_LABEL, `The label can be at most ${MAX_LABEL} characters.`),
  /** Every word drawn on a poster, so the server can check it too (the browser check can be skipped). */
  text: z.string().max(MAX_TEXT, "The poster text is too long."),
});

export async function GET(_req: Request, { params }: Ctx) {
  return NextResponse.json(listImages(Number((await params).id)));
}

/**
 * multipart/form-data: files[], kind? ("original" by default; "price_card" or "poster" from the poster maker),
 * label? (posters only, at most 80 characters), text? (all words on the poster, checked for banned claims)
 */
export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the photos as a file upload." }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Choose at least one photo." }, { status: 400 });
  if (files.length > MAX_PHOTOS) return NextResponse.json({ error: `Add at most ${MAX_PHOTOS} photos at a time.` }, { status: 400 });

  const str = (k: string, fallback = "") => {
    const v = form.get(k);
    return typeof v === "string" ? v : fallback;
  };
  const parsed = Fields.safeParse({ kind: str("kind", "original") || "original", label: str("label"), text: str("text") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid upload." }, { status: 400 });
  const { kind, label, text } = parsed.data;

  if (kind !== "original") {
    const problems = scanText(`${label}\n${text}`, claimContext(product));
    if (problems.length) {
      return NextResponse.json({ error: `The poster text has ${problems.join("; ")}. Change the wording first.` }, { status: 422 });
    }
  }

  try {
    const ids = await ingestFiles(
      id,
      files,
      kind === "original"
        ? {}
        : { kind, label: label || CODE_DRAWN[kind], model_used: "code", approved: true, prompt_used: text || undefined }
    );
    return NextResponse.json({ ids }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: `Could not read one of the photos (${msg}). Use JPG or PNG.` },
      { status: 400 }
    );
  }
}
