import { NextResponse } from "next/server";
import { sendDraft } from "@/lib/inboxService";
import { getDraft } from "@/lib/inbox";

export const runtime = "nodejs";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

/** Approves a draft and sends it when live sending is on and Instagram's rules allow it. Otherwise it is marked approved to copy. */
export async function POST(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Bad draft id." }, { status: 400 });
  const outcome = await sendDraft(id);
  return NextResponse.json({ ...outcome, draft: getDraft(id) }, { status: outcome.ok ? 200 : outcome.how === "refused" ? 409 : 422 });
}
