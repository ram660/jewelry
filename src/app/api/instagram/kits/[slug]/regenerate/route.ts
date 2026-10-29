import { NextResponse } from "next/server";
import { z } from "zod";
import { BACKDROPS, startRegenerate } from "@/lib/kitJobs";

export const runtime = "nodejs";

const Body = z.object({ backdrop: z.enum(BACKDROPS).default("auto"), dropDark: z.boolean().default(false), claude: z.boolean().default(false) });

/** Makes the studio images again with another backdrop (cached cutout, the jewellery unchanged). Keeps the current ones. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid request." }, { status: 400 });
  const r = startRegenerate(slug, parsed.data);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ jobId: r.job.id });
}
