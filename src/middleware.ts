import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "./lib/guardrequest";

/** Runs before every page and API route. See lib/guardrequest.ts for what it stops and why. */
export function middleware(req: NextRequest) {
  const verdict = checkRequest({
    method: req.method,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    allowedHosts: (process.env.EFJ_ALLOWED_HOSTS ?? "").split(","),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.why }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
