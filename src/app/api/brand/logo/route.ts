import { NextResponse } from "next/server";
import { LogoError, MAX_LOGO_BYTES, hasCustomLogo, logoPng, removeCustomLogo, saveCustomLogo } from "@/lib/brand";

export const runtime = "nodejs";

/** GET ?ink=light|dark → the logo as PNG (the owner's upload, or the placeholder). */
export async function GET(req: Request) {
  const ink = new URL(req.url).searchParams.get("ink") === "light" ? "light" : "dark";
  const png = await logoPng(ink);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Logo-Source": (await hasCustomLogo()) ? "custom" : "placeholder",
    },
  });
}

/** multipart/form-data: file (PNG, JPG or WebP, at most 5 MB). Replaces the placeholder everywhere. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a logo file." }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: "The logo file is larger than 5 MB." }, { status: 400 });
  try {
    await saveCustomLogo(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, source: "custom" }, { status: 201 });
  } catch (e) {
    if (e instanceof LogoError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** Back to the placeholder logo. */
export async function DELETE() {
  await removeCustomLogo();
  return NextResponse.json({ ok: true, source: "placeholder" });
}
