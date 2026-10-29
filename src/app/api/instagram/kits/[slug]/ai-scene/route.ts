import { NextResponse } from "next/server";
import { z } from "zod";
import { startAiScene } from "@/lib/kitJobs";
import { AI_STYLE_IDS } from "@/lib/aiScene";

export const runtime = "nodejs";

const Body = z.object({ count: z.union([z.literal(1), z.literal(2)]).default(1), style: z.enum(AI_STYLE_IDS).default("soft-studio") });

/** Makes 1 or 2 AI scenes with Gemini. Only the owner's button calls this; nothing else does. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid request." }, { status: 400 });
  const r = startAiScene(slug, parsed.data);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ jobId: r.job.id });
}
