import { NextResponse } from "next/server";
import { z } from "zod";
import { getDraft, updateDraft } from "@/lib/inbox";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  text: z.string().max(1000).optional(),
  /** dismissed: not answering. pending: undo a dismiss. sent: the owner sent it by hand in the Instagram app. */
  status: z.enum(["dismissed", "pending", "sent"]).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const draft = Number.isInteger(id) ? getDraft(id) : null;
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the fields.", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { text, status } = parsed.data;

  if (draft.status === "sending" || draft.status === "sent") {
    return NextResponse.json({ error: `This draft is already ${draft.status}.` }, { status: 409 });
  }
  if (draft.status === "unsure" && text !== undefined) {
    return NextResponse.json({ error: "Check Instagram first, then choose \"I sent it\" or \"Try again\"." }, { status: 409 });
  }
  // "sent" is the owner's word that it went out: after approving a copy, or after checking Instagram on an unsure send.
  if (status === "sent" && draft.status !== "approved" && draft.status !== "unsure") {
    return NextResponse.json({ error: "Approve the reply first, then mark it as sent once you have sent it in Instagram." }, { status: 409 });
  }
  if (text !== undefined) {
    // An edit needs a fresh approval.
    updateDraft(id, { text, status: draft.status === "approved" ? "pending" : draft.status, error: null });
  }
  if (status && !(status === "sent" && text !== undefined)) {
    updateDraft(id, { status, sent: status === "sent", error: null });
  }
  return NextResponse.json(getDraft(id));
}
