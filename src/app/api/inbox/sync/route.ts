import { NextResponse } from "next/server";
import { syncRelay } from "@/lib/inboxService";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pulls new customer messages from the relay and writes draft replies for them. */
export async function POST() {
  try {
    return NextResponse.json(await syncRelay());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed." }, { status: 502 });
  }
}
