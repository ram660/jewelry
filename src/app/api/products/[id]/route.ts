import { NextResponse } from "next/server";
import { deleteProduct, getProduct, markAnalysed, updateProduct } from "@/lib/db";
import { removeProductDir } from "@/lib/storage";
import { READY_STATES, checkProduct } from "@/lib/claims";
import { ProductPatch } from "@/lib/productPatch";
import { approvedPhotoCount } from "@/lib/readiness";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const p = getProduct(Number((await params).id));
  return p ? NextResponse.json(p) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Bad product id." }, { status: 400 });
  const current = getProduct(id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Send a JSON object of fields to change." }, { status: 400 });
  }
  const parsed = ProductPatch.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    return NextResponse.json({ error: field ? `${field}: ${issue.message}` : "Invalid fields." }, { status: 400 });
  }
  // `mark_analysed: true` records that the details were written by an AI step (the in-app analysis, or an assistant
  // such as Claude Code using scripts/efj.mjs). It is not a product field, so it is split off first.
  const { mark_analysed, ...patch } = parsed.data;

  // A product that is ready / scheduled / posted must pass the checks, so nothing
  // with a banned claim or a missing price can reach Instagram.
  const merged = { ...current, ...patch } as Product;
  if (READY_STATES.includes(merged.status)) {
    const blockers = checkProduct(merged, approvedPhotoCount(id)).filter((x) => x.level === "block");
    if (blockers.length) {
      return NextResponse.json(
        { error: "Fix these before the product can be marked ready.", problems: blockers.map((b) => b.message) },
        { status: 422 }
      );
    }
  }
  const updated = updateProduct(id, patch);
  if (mark_analysed === true) {
    markAnalysed(id);
    return NextResponse.json(getProduct(id));
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  deleteProduct(id);
  await removeProductDir(id);
  return NextResponse.json({ ok: true });
}
