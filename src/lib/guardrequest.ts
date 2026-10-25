/**
 * Protects the Studio from web pages the owner happens to visit. The Studio has no login because it only runs on this computer,
 * so a hostile page could otherwise make the owner's browser press its buttons (cross-site request forgery), or reach it through
 * a look-alike host name (DNS rebinding). Pure, so it can be tested; used by src/middleware.ts.
 *
 * Command-line tools such as scripts/efj.mjs send no Origin and no Sec-Fetch-Site headers and are allowed through.
 * Set EFJ_ALLOWED_HOSTS (comma separated, for example "studio.local:3000") if you open the Studio under another name.
 */

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export interface RequestFacts {
  method: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  allowedHosts?: string[];
}

export type Verdict = { ok: true } | { ok: false; why: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function checkRequest(r: RequestFacts): Verdict {
  const host = (r.host ?? "").trim();
  const allowed = (r.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!host || !(LOCAL.test(host) || allowed.includes(host.toLowerCase()))) {
    return { ok: false, why: "Unexpected host name. The Studio only answers on localhost." };
  }
  if (SAFE_METHODS.has(r.method.toUpperCase())) return { ok: true };

  // Anything that changes data must come from this site itself (or from a command-line tool).
  if (r.secFetchSite && r.secFetchSite !== "same-origin" && r.secFetchSite !== "none") {
    return { ok: false, why: "Blocked: this request came from another website." };
  }
  if (r.origin) {
    let originHost = "";
    try { originHost = new URL(r.origin).host; } catch { /* treated as foreign below */ }
    if (!originHost || originHost.toLowerCase() !== host.toLowerCase()) {
      return { ok: false, why: "Blocked: this request came from another website." };
    }
  }
  return { ok: true };
}
