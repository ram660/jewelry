import { NextResponse } from "next/server";
import { z } from "zod";
import { Draft } from "@/lib/kitDraft";
import { readKit, saveDraft } from "@/lib/kits";
import { startCreateReel } from "@/lib/kitJobs";
import { runningJob } from "@/lib/jobs";
import { chooseReel } from "@/lib/reelVariants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

/** "Create Reel": a new Reel in a different style from the last one. Posts nothing. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!readKit(slug)) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const parsed = Draft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid draft." }, { status: 400 });
  const r = startCreateReel(slug, parsed.data);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  saveDraft(slug, { ...parsed.data, marked: readKit(slug)!.draft.marked || parsed.data.marked });
  return NextResponse.json({ jobId: r.job.id });
}

const Choose = z.object({ file: z.string().max(140) });

/** Picks one of the kept Reels as the one Post uses. */
export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!readKit(slug)) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const parsed = Choose.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid request." }, { status: 400 });
  if (runningJob(slug, "publish") || runningJob(slug, "reel")) return NextResponse.json({ error: "Wait for the current step to finish first." }, { status: 409 });
  if (!chooseReel(slug, parsed.data.file)) return NextResponse.json({ error: "That Reel isn't one of this kit's." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
