import { NextResponse } from "next/server";
import { Draft } from "@/lib/kitDraft";
import { readKit, saveDraft } from "@/lib/kits";
import { writePost } from "@/lib/aiPost";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Rewrite: the AI writes a new caption, hashtags and alt text. Keeps the owner's price, slides and choices. Posts nothing. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kit = readKit(slug);
  if (!kit) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const parsed = Draft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid draft." }, { status: 400 });
  const d = parsed.data;
  const draft = await writePost(slug, d, { name: kit.title, category: d.category, tone: d.tone });
  saveDraft(slug, draft);
  return NextResponse.json(draft);
}
