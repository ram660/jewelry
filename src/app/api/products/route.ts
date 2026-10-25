import { NextResponse } from "next/server";
import { createProduct, deleteProduct, listProducts } from "@/lib/db";
import { MAX_PHOTOS, ingestFiles, removeProductDir } from "@/lib/storage";
import { CATEGORIES } from "@/lib/types";
import { describeDuplicates, findDuplicateUploads } from "@/lib/duplicates";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(listProducts());
}

/** multipart/form-data: name, category?, files[] (one or more photos of ONE piece) */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the photos as a file upload." }, { status: 400 });
  const name = String(form.get("name") ?? "").trim();
  const catRaw = String(form.get("category") ?? "other");
  const category = (CATEGORIES as readonly string[]).includes(catRaw) ? catRaw : "other";
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (name.length > 120) return NextResponse.json({ error: "The name can be at most 120 characters." }, { status: 400 });
  if (!files.length) {
    return NextResponse.json({ error: "Add at least one photo." }, { status: 400 });
  }
  if (files.length > MAX_PHOTOS) return NextResponse.json({ error: `Add at most ${MAX_PHOTOS} photos at a time.` }, { status: 400 });

  // Stop the same photos being added again (a retried upload used to create a second product). "Upload anyway" skips this.
  if (form.get("allowDuplicates") !== "1") {
    const dup = await findDuplicateUploads(files);
    if (dup.existing.length || dup.repeated.length) {
      return NextResponse.json({ error: describeDuplicates(dup), code: "duplicate_photos", ...dup }, { status: 409 });
    }
  }

  const product = createProduct(name, category);
  try {
    await ingestFiles(product.id, files);
  } catch (e) {
    deleteProduct(product.id);
    await removeProductDir(product.id);
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: `Could not read one of the photos (${msg}). HEIC files are not supported yet; use JPG or PNG.` },
      { status: 400 }
    );
  }
  return NextResponse.json({ id: product.id }, { status: 201 });
}
