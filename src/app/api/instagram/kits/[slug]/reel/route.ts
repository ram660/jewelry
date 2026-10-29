import { NextResponse } from "next/server";
import { Draft } from "@/lib/kitDraft";
import { saveDraft, readKit } from "@/lib/kits";
import { startReel } from "@/lib/kitJobs";

export const runtime = "nodejs";

/** Builds the kit's Reel (slides + Story image, with the chosen music track). Posts nothing. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!readKit(slug)) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const parsed = Draft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid draft." }, { status: 400 });
  const r = startReel(slug, parsed.data);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  saveDraft(slug, { ...parsed.data, marked: readKit(slug)!.draft.marked || parsed.data.marked });
  return NextResponse.json({ jobId: r.job.id });
}
