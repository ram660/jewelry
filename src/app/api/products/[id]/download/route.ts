import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProduct, listImages } from "@/lib/db";
import { uploadPath } from "@/lib/storage";
import { makeZip } from "@/lib/zip";

export const runtime = "nodejs";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";

/**
 * ZIP of this product's pictures, exactly as stored (nothing is re-drawn or re-compressed):
 *   ?set=originals  your own photos, to attach in Gemini or anywhere else
 *   ?set=rendered   everything made from them: studio shots, clean backgrounds, cut-outs, posters and so on
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const set = new URL(req.url).searchParams.get("set");
  if (set !== "originals" && set !== "rendered") {
    return NextResponse.json({ error: "Use ?set=originals or ?set=rendered." }, { status: 400 });
  }
  const images = listImages(id).filter((i) => (set === "originals" ? i.kind === "original" : i.kind !== "original"));
  if (!images.length) {
    return NextResponse.json({ error: set === "originals" ? "This product has no photos." : "Nothing has been rendered yet." }, { status: 404 });
  }

  const entries = [];
  for (const [n, im] of images.entries()) {
    const ext = path.extname(im.path) || ".jpg";
    const name = `${String(n + 1).padStart(2, "0")}-${slug(set === "originals" ? "photo" : im.label || im.kind)}${ext}`;
    entries.push({ name, data: await fs.readFile(uploadPath(im.path)) });
  }

  const base = slug(product.name || product.sku);
  return new Response(new Uint8Array(makeZip(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${base}-${set}.zip"`,
    },
  });
}
