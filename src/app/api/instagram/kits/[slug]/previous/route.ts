import { NextResponse } from "next/server";
import { kitDir, swapPrevious } from "@/lib/kits";
import { runningJob } from "@/lib/jobs";

export const runtime = "nodejs";

/** Goes back to the studio images from before the last regenerate (and pressing it again goes forward). */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!kitDir(slug)) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  if (runningJob(slug, "regen") || runningJob(slug, "publish") || runningJob(slug, "reel")) return NextResponse.json({ error: "Wait for the current step to finish first." }, { status: 409 });
  if (!swapPrevious(slug)) return NextResponse.json({ error: "There is no earlier version." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
