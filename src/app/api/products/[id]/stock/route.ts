import { NextResponse } from "next/server";
import { z } from "zod";
import { adjustStock } from "@/lib/db";

export const runtime = "nodejs";

const Body = z.object({
  delta: z.number({ error: "delta must be a non-zero whole number" }).int("delta must be a non-zero whole number")
    .min(-100000).max(100000).refine((d) => d !== 0, "delta must be a non-zero whole number"),
  reason: z.string().trim().max(200, "The reason can be at most 200 characters.").optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { delta, reason } = parsed.data;
  const p = Number.isInteger(id) ? adjustStock(id, delta, reason || "adjust") : null;
  return p ? NextResponse.json(p) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
