import { igApiBase } from "../config";

/**
 * Sends replies through the Instagram API. This is the only code that holds the access token.
 * The token goes in a header, never in the URL (URLs end up in logs), and is scrubbed from any error text.
 */

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when we cannot tell whether Instagram got the message (timeout, dropped connection, server error). */
  unknown?: boolean;
}

/**
 * The access token is only ever sent to Instagram's own hosts. A test server on this computer is allowed so the send step can be
 * tested without a real account.
 */
function checkedBase(): string | null {
  const base = igApiBase();
  try {
    const u = new URL(base);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    const official = u.protocol === "https:" && (u.hostname === "graph.instagram.com" || u.hostname === "graph.facebook.com");
    return official || local ? base : null;
  } catch {
    return null;
  }
}

function scrub(text: string): string {
  const token = process.env.IG_ACCESS_TOKEN;
  return token ? text.split(token).join("[token]") : text;
}

async function post(path: string, body: object): Promise<SendResult> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "IG_ACCESS_TOKEN is not set in .env.local." };
  const base = checkedBase();
  if (!base) return { ok: false, error: "IG_API_BASE must point at graph.instagram.com or graph.facebook.com. The access token was not sent." };
  let res: Response;
  try {
    res = await fetch(`${base}/${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, unknown: true, error: scrub(`The connection to Instagram failed (${e instanceof Error ? e.message : String(e)}), so the reply may or may not have gone through.`) };
  }
  const parsed = (await res.json().catch(() => null)) as { id?: string; message_id?: string; error?: { message?: string; code?: number } } | null;
  const json = parsed ?? {};
  if (res.ok && !json.error) return { ok: true, id: json.message_id ?? json.id };
  // A clear refusal from Instagram (a 4xx with an error body) means it was NOT sent. Anything else is unknown.
  const definite = res.status >= 400 && res.status < 500 && Boolean(parsed?.error);
  const msg = json.error?.message ?? `HTTP ${res.status}`;
  return {
    ok: false,
    unknown: !definite,
    error: scrub(
      definite
        ? `Instagram refused it${json.error?.code ? ` (code ${json.error.code})` : ""}: ${msg}`
        : `Instagram answered with an unexpected error (${res.status}), so the reply may or may not have gone through.`
    ).slice(0, 400),
  };
}

/** A direct message to a customer, inside the 24-hour window after their last message. */
export const sendDm = (recipientId: string, text: string) =>
  post("me/messages", { recipient: { id: recipientId }, message: { text } });

/** A private reply to a comment: one per comment, within 7 days. */
export const sendPrivateReply = (commentId: string, text: string) =>
  post("me/messages", { recipient: { comment_id: commentId }, message: { text } });

/** A public reply under a comment. */
export const replyToComment = (commentId: string, text: string) => post(`${encodeURIComponent(commentId)}/replies`, { message: text });
