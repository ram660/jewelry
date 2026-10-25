import sharp from "sharp";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getProduct, listCarousel, setCarousel } from "@/lib/db";
import { uploadPath } from "@/lib/storage";
import { makeZip } from "@/lib/zip";
import { MAX_CAROUSEL } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ ids: z.array(z.number().int().positive()).max(50) });

/** Replace the carousel: { ids: number[] } in slide order. Only approved photos are kept; max 10. */
export async function PUT(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!getProduct(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ids must be a list of photo numbers" }, { status: 400 });
  return NextResponse.json({ ids: setCarousel(id, parsed.data.ids, MAX_CAROUSEL) });
}

/** ZIP of Instagram-ready slides (1080x1350, 4:5) in order, plus caption.txt. */
export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const slides = listCarousel(id);
  if (!slides.length) {
    return NextResponse.json({ error: "The carousel is empty. Add approved photos first." }, { status: 400 });
  }

  const entries = [];
  for (const [i, s] of slides.entries()) {
    // "contain" on an off-white canvas: never crops the jewellery.
    const data = await sharp(uploadPath(s.path))
      .resize(1080, 1350, { fit: "contain", background: "#faf8f4" })
      .jpeg({ quality: 92 })
      .toBuffer();
    entries.push({ name: `${String(i + 1).padStart(2, "0")}-${s.kind.replace("_", "-")}.jpg`, data });
  }

  const caption = product.captions[0] ?? "";
  const text = [caption, ".", product.hashtags.join(" ")].filter((x) => x !== "").join("\n");
  entries.push({ name: "caption.txt", data: Buffer.from(text + "\n", "utf8") });

  const safeName = (product.name || product.sku).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "carousel";
  return new Response(new Uint8Array(makeZip(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}-carousel.zip"`,
    },
  });
}
