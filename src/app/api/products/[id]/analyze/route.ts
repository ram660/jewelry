import { NextResponse } from "next/server";
import { getProduct, listImages, markAnalysed, updateProduct } from "@/lib/db";
import { analyseProduct, analysisToPatch } from "@/lib/ai";
import { READY_STATES, checkProduct } from "@/lib/claims";
import { ProductPatch } from "@/lib/productPatch";

export const runtime = "nodejs";
export const maxDuration = 120;

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const images = listImages(id);
  const originals = images.filter((i) => i.kind === "original");
  if (!originals.length) return NextResponse.json({ error: "This product has no photos." }, { status: 400 });

  try {
    const { result, demo } = await analyseProduct(product, originals);
    let patch = analysisToPatch(result, product);
    // Template text (no AI) only fills gaps: it never overwrites what the owner already wrote.
    if (demo) patch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => isEmpty(product[k as keyof typeof product]) && !isEmpty(v)));
    // Same shape and length limits as an owner edit, so AI text can never make the product unsaveable.
    const clean = ProductPatch.safeParse(patch);
    if (!clean.success) throw new Error("The AI returned details in an unexpected shape. Try again.");
    let updated = updateProduct(id, clean.data);
    markAnalysed(id);

    // New AI text must not silently break a ready product: send it back to draft for review.
    let demoted = false;
    if (updated && READY_STATES.includes(updated.status)) {
      if (checkProduct(updated, images.length).some((x) => x.level === "block")) {
        updated = updateProduct(id, { status: "draft" });
        demoted = true;
      }
    }
    return NextResponse.json({
      product: getProduct(id),
      demo,
      demoted,
      name_suggestions: result.name_suggestions,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI analysis failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
