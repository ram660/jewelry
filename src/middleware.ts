import { NextResponse, type NextRequest } from "next/server";

/**
 * The app has no login: it runs on the owner's computer. This stops another website open in the same browser from
 * quietly sending changes to it (cross-site requests). Reads (GET) are untouched; scripts such as scripts/efj.mjs
 * send no Origin header and are allowed.
 */
export function middleware(req: NextRequest) {
  // The app answers only under a local name. This stops a web page from reaching it through a look-alike host name
  // (DNS rebinding). Set EFJ_ALLOWED_HOSTS (comma separated, with port) to open it under another name on purpose.
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const allowed = (process.env.EFJ_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host) && !allowed.includes(host)) {
    return NextResponse.json({ error: "This app only answers on localhost." }, { status: 403 });
  }
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

// Pages as well as the API: a page read through a look-alike host name would show the whole catalog.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
