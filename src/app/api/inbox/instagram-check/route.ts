import { NextResponse } from "next/server";
import { checkToken } from "@/lib/providers/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only check that the Instagram access token works. Sends nothing to customers and posts nothing. */
export async function GET() {
  const result = await checkToken();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
