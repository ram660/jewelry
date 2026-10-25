import { NextResponse } from "next/server";
import { z } from "zod";
import { getProduct } from "@/lib/db";
import { getEvent, setEventProduct } from "@/lib/inbox";
import { draftForEvent } from "@/lib/inboxService";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ productId: z.number().int().positive().nullable() });

/** Choose which piece a customer is asking about. Open drafts are rewritten for that piece. */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !getEvent(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { productId: number | null }." }, { status: 400 });
  const { productId } = parsed.data;
  if (productId != null && !getProduct(productId)) return NextResponse.json({ error: "That product does not exist." }, { status: 400 });
  setEventProduct(id, productId);
  draftForEvent(id);
  return NextResponse.json({ ok: true });
}
