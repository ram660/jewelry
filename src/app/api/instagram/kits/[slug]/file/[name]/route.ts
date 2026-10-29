import { NextResponse } from "next/server";
import { kitFile } from "@/lib/kits";
import { sendFile } from "@/lib/sendFile";

export const runtime = "nodejs";

/** A kit's own images and Reel, for the preview. Nothing else in the folder can be read through this. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; name: string }> }) {
  const { slug, name } = await params;
  const full = kitFile(slug, name);
  if (!full) return new NextResponse("Bad path", { status: 400 });
  return sendFile(req, full);
}
