import { NextResponse } from "next/server";
import { trackFile } from "@/lib/kits";
import { sendFile } from "@/lib/sendFile";

export const runtime = "nodejs";

/** A music track from the audio folder, to listen to before picking it. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const full = trackFile(decodeURIComponent((await params).name));
  if (!full) return new NextResponse("Not found", { status: 404 });
  return sendFile(req, full);
}
