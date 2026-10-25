import { NextResponse, type NextRequest } from "next/server";

/**
 * The app has no login: it runs on the owner's computer. This stops another website open in the same browser from
 * quietly sending changes to it (cross-site requests). Reads (GET) are untouched; scripts such as scripts/efj.mjs
 * send no Origin header and are allowed.
 */
export function middleware(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Changes are only accepted from this app's own pages." }, { status: 403 });
  }
  // Browsers mark cross-site form posts even when they hide the Origin.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Changes are only accepted from this app's own pages." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
