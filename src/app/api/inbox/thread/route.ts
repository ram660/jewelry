import { NextResponse } from "next/server";
import { listProducts } from "@/lib/db";
import { threadEvents } from "@/lib/inbox";

export const runtime = "nodejs";

/** All messages and drafts for one customer, plus a short product list for the "which piece" picker. */
export async function GET(req: Request) {
  const sender = new URL(req.url).searchParams.get("sender") ?? "";
  if (!sender || sender.length > 120) return NextResponse.json({ error: "Missing customer." }, { status: 400 });
  const products = listProducts().map((p) => ({
    id: p.id, name: p.name || p.sku, sku: p.sku, price_cad: p.price_cad, nickel_free: p.nickel_free, hypoallergenic: p.hypoallergenic,
  }));
  return NextResponse.json({ items: threadEvents(sender), products });
}
