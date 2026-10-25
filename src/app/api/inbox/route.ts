import { NextResponse } from "next/server";
import { igSendMode, igTokenConfigured, relayConfigured } from "@/lib/config";
import { listProducts } from "@/lib/db";
import { listThreads, openDraftCount } from "@/lib/inbox";

export const runtime = "nodejs";

/** The customer list and the connection status. Never returns a token, only whether one is set. */
export async function GET() {
  return NextResponse.json({
    threads: listThreads(),
    products: listProducts().map((p) => ({ id: p.id, name: p.name || p.sku })),
    open: openDraftCount(),
    config: { relay: relayConfigured(), token: igTokenConfigured(), mode: igSendMode() },
  });
}
