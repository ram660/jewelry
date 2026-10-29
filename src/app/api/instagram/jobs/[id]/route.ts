import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

/** Progress of a kit, Reel or publish job started from the Instagram page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "No such job (the Studio may have restarted)." }, { status: 404 });
  return NextResponse.json(job);
}
