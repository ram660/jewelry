import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteImage, getImage, makePrimary, setApproved, setFidelity } from "@/lib/db";
import { removeFiles } from "@/lib/storage";
import { demoteIfBlocked } from "@/lib/readiness";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

const MAX_NOTES = 500;

const Patch = z.object({
  approved: z.boolean({ error: "approved must be true or false." }).optional(),
  primary: z.boolean({ error: "primary must be true or false." }).optional(),
  fidelity_score: z
    .number({ error: "fidelity_score must be a whole number from 0 to 100, or null." })
    .int("fidelity_score must be a whole number from 0 to 100, or null.")
    .min(0, "fidelity_score must be a whole number from 0 to 100, or null.")
    .max(100, "fidelity_score must be a whole number from 0 to 100, or null.")
    .nullable()
    .optional(),
  fidelity_notes: z
    .string({ error: `fidelity_notes must be text of at most ${MAX_NOTES} characters, or null.` })
    .max(MAX_NOTES, `fidelity_notes must be text of at most ${MAX_NOTES} characters, or null.`)
    .nullable()
    .optional(),
}, { error: "Send a JSON object." });

/** { approved?: boolean, primary?: true, fidelity_score?: 0-100 | null, fidelity_notes?: string | null } */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!getImage(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Validate everything first so a bad field never leaves the image half-updated.
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send a JSON object." }, { status: 400 });
  const body = parsed.data;

  const before = getImage(id)!;
  if (typeof body.approved === "boolean") {
    setApproved(id, body.approved);
    // Un-approving the last photo must not leave a ready product without one.
    if (!body.approved) demoteIfBlocked(before.product_id);
  }
  if (body.primary) makePrimary(id);
  if (body.fidelity_score !== undefined || body.fidelity_notes !== undefined) {
    setFidelity(id, {
      ...(body.fidelity_score !== undefined ? { score: body.fidelity_score } : {}),
      ...(body.fidelity_notes !== undefined ? { notes: body.fidelity_notes } : {}),
    });
  }
  return NextResponse.json(getImage(id));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const img = deleteImage(Number((await params).id));
  if (img) {
    await removeFiles(img.path, img.thumb_path);
    demoteIfBlocked(img.product_id);
  }
  return NextResponse.json({ ok: true });
}
