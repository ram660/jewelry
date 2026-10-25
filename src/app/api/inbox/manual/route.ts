import { NextResponse } from "next/server";
import { z } from "zod";
import { getProduct } from "@/lib/db";
import { addManual } from "@/lib/inboxService";

export const runtime = "nodejs";

const Body = z.object({
  kind: z.enum(["dm", "comment"]),
  label: z.string().max(60).default(""),
  text: z.string().trim().min(1, "Paste the customer's message.").max(2000),
  productId: z.number().int().positive().nullable().optional(),
});

/** Adds a message by hand, for example one read in the Instagram app, and drafts a reply for it. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form.", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const b = parsed.data;
  if (b.productId != null && !getProduct(b.productId)) return NextResponse.json({ error: "That product does not exist." }, { status: 400 });
  const event = addManual({ kind: b.kind, label: b.label, text: b.text, productId: b.productId ?? null });
  return NextResponse.json({ sender: event.sender, id: event.id });
}
