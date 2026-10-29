import { NextResponse } from "next/server";
import { z } from "zod";
import { Draft } from "@/lib/kitDraft";
import { startPublish } from "@/lib/kitJobs";

export const runtime = "nodejs";

const Body = z.object({
  draft: Draft,
  /** Only the Post button's confirm dialog sends this. */
  confirm: z.literal(true),
});

/**
 * Publishes the kit to Instagram as the owner reviewed it. The server checks the text again (blanks, banned wording) and
 * refuses anything this kit already has on Instagram, so a second click or a stale page can't post twice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid publish request." }, { status: 400 });
  const r = startPublish(slug, parsed.data.draft);
  if ("error" in r) return NextResponse.json({ error: r.error, problems: r.problems }, { status: r.status });
  return NextResponse.json({ jobId: r.job.id });
}
