import { igApiBase } from "../config";

/**
 * Sends replies and publishes posts through the Instagram API. This is the only code that holds the access token.
 * The token goes in a header, never in the URL (URLs end up in logs), and is scrubbed from any error text.
 */

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when we cannot tell whether Instagram got the message (timeout, dropped connection, server error). */
  unknown?: boolean;
  /** Instagram's error code, when it gave one. */
  code?: number;
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
    ...(definite && json.error?.code ? { code: json.error.code } : {}),
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

export interface CallResult {
  status: number;
  data?: Record<string, unknown>;
  error?: string;
}

/** A read-only GET. Never sends or changes anything on Instagram. */
async function get(path: string, token: string, base: string): Promise<CallResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { status: 0, error: scrub(`The connection to Instagram failed (${e instanceof Error ? e.message : String(e)}).`) };
  }
  const json = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (res.ok && !json.error) return { status: res.status, data: json };
  const msg = json.error?.message ?? `HTTP ${res.status}`;
  return { status: res.status, error: scrub(`${json.error?.code ? `code ${json.error.code}: ` : ""}${msg}`).slice(0, 400) };
}

export interface TokenCheck {
  ok: boolean;
  error?: string;
  me?: CallResult;
  publishingLimit?: CallResult;
  username?: string;
  accountType?: string;
  userId?: string;
  /** Whether the token's user_id matches IG_USER_ID (null when IG_USER_ID is not set). */
  userIdMatches?: boolean | null;
}

export interface PublishPlan {
  /** "image": one feed photo. "carousel": 2 to 10 feed photos. "story": one Story. "reel": one video with its sound. */
  kind: "image" | "carousel" | "story" | "reel";
  /** Public https addresses Instagram downloads the JPEGs from, in slide order (empty for a Reel). */
  imageUrls: string[];
  /** Public https address of the Reel's MP4 (Reels only). */
  videoUrl?: string;
  /** Caption with hashtags (not used for a Story). */
  caption?: string;
  /** Alt text per image, same order as imageUrls (not used for a Story). */
  altTexts?: string[];
}

export interface PublishResult {
  ok: boolean;
  mediaId?: string;
  permalink?: string;
  error?: string;
  /** True when the publish call itself got no clear answer: the post may be live. Check Instagram before trying again. */
  unknown?: boolean;
}

/** How long Instagram gets to download and process the images before we give up (nothing is published then). */
const PROCESS_TIMEOUT_MS = Number(process.env.IG_PROCESS_TIMEOUT_MS) || 120_000;
/** Videos take longer: Instagram transcodes a Reel before it can be published. */
const VIDEO_TIMEOUT_MS = Number(process.env.IG_VIDEO_TIMEOUT_MS) || 300_000;
const POLL_MS = Number(process.env.IG_POLL_MS) || 3_000;
/**
 * Instagram sometimes answers media_publish for a Story or Reel with code 24 ("the requested resource does not exist") for
 * a few seconds after its container reports FINISHED. That is a clear refusal (nothing was published), so publishing the same
 * container again after a pause is safe. Any other refusal, and any unclear answer, is never retried.
 */
const NOT_YET_CODE = 24;
const NOT_YET_RETRIES = 3;
const NOT_YET_WAIT_MS = Number(process.env.IG_NOT_YET_WAIT_MS) || 5_000;

async function waitUntilReady(id: string, token: string, base: string, timeoutMs = PROCESS_TIMEOUT_MS): Promise<string | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await get(`${encodeURIComponent(id)}?fields=status_code`, token, base);
    const status = r.data?.status_code;
    if (status === "FINISHED") return null;
    if (status === "ERROR" || status === "EXPIRED") return `Instagram could not use the image (${status}). Nothing was published.`;
    if (Date.now() > until) return `Instagram was still processing after ${Math.round(timeoutMs / 1000)} s. Nothing was published.`;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Publishes one post. Containers are created first and checked until Instagram has processed them; media_publish is then
 * never retried after an unclear answer, because a lost answer may still mean the post went live. The only retry is a
 * Story or Reel that Instagram clearly refused with code 24 (see NOT_YET_CODE).
 */
export async function publishPost(plan: PublishPlan): Promise<PublishResult> {
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = (process.env.IG_USER_ID || "").trim();
  if (!token) return { ok: false, error: "IG_ACCESS_TOKEN is not set in .env.local." };
  if (!userId) return { ok: false, error: "IG_USER_ID is not set in .env.local." };
  const base = checkedBase();
  if (!base) return { ok: false, error: "IG_API_BASE must point at graph.instagram.com or graph.facebook.com. The access token was not sent." };
  const n = plan.imageUrls.length;
  if (plan.kind === "reel" ? !plan.videoUrl || n !== 0 : plan.kind === "carousel" ? n < 2 || n > 10 : n !== 1) {
    return { ok: false, error: "Wrong number of images for this post type." };
  }
  const media = `${encodeURIComponent(userId)}/media`;
  const create = async (body: object): Promise<{ id?: string; error?: string }> => {
    const r = await post(media, body);
    return r.ok && r.id ? { id: r.id } : { error: `Instagram did not accept the image: ${r.error ?? "no id returned"}. Nothing was published.` };
  };

  let creationId: string;
  if (plan.kind === "carousel") {
    const children: string[] = [];
    for (const [i, url] of plan.imageUrls.entries()) {
      const alt = plan.altTexts?.[i];
      const c = await create({ image_url: url, is_carousel_item: true, ...(alt ? { alt_text: alt } : {}) });
      if (!c.id) return { ok: false, error: c.error };
      const wait = await waitUntilReady(c.id, token, base);
      if (wait) return { ok: false, error: wait };
      children.push(c.id);
    }
    const parent = await create({ media_type: "CAROUSEL", children: children.join(","), caption: plan.caption ?? "" });
    if (!parent.id) return { ok: false, error: parent.error };
    creationId = parent.id;
  } else if (plan.kind === "reel") {
    const c = await create({ media_type: "REELS", video_url: plan.videoUrl, caption: plan.caption ?? "", share_to_feed: true });
    if (!c.id) return { ok: false, error: c.error };
    creationId = c.id;
  } else {
    const alt = plan.altTexts?.[0];
    const body =
      plan.kind === "story"
        ? { image_url: plan.imageUrls[0], media_type: "STORIES" }
        : { image_url: plan.imageUrls[0], caption: plan.caption ?? "", ...(alt ? { alt_text: alt } : {}) };
    const c = await create(body);
    if (!c.id) return { ok: false, error: c.error };
    creationId = c.id;
  }
  const wait = await waitUntilReady(creationId, token, base, plan.kind === "reel" ? VIDEO_TIMEOUT_MS : PROCESS_TIMEOUT_MS);
  if (wait) return { ok: false, error: wait };

  let published = await post(`${encodeURIComponent(userId)}/media_publish`, { creation_id: creationId });
  for (let i = 0; i < NOT_YET_RETRIES && !published.ok && !published.unknown && published.code === NOT_YET_CODE && plan.kind !== "carousel" && plan.kind !== "image"; i++) {
    await new Promise((r) => setTimeout(r, NOT_YET_WAIT_MS));
    published = await post(`${encodeURIComponent(userId)}/media_publish`, { creation_id: creationId });
  }
  if (!published.ok) {
    return published.unknown
      ? { ok: false, unknown: true, error: "Instagram gave no clear answer to the publish step, so the post may be live. Check Instagram before trying again." }
      : { ok: false, error: `Instagram refused to publish: ${published.error}` };
  }
  const mediaId = published.id;
  const link = mediaId ? await get(`${encodeURIComponent(mediaId)}?fields=permalink`, token, base) : null;
  return { ok: true, mediaId, permalink: link?.data?.permalink as string | undefined };
}

/** Read-only check that the access token works: who it belongs to, and the posting quota (which needs the publish permission). */
export async function checkToken(): Promise<TokenCheck> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "IG_ACCESS_TOKEN is not set in .env.local." };
  const base = checkedBase();
  if (!base) return { ok: false, error: "IG_API_BASE must point at graph.instagram.com or graph.facebook.com. The access token was not sent." };
  const me = await get("me?fields=user_id,username,account_type,media_count", token, base);
  const expected = (process.env.IG_USER_ID || "").trim();
  const userId = me.data?.user_id != null ? String(me.data.user_id) : undefined;
  const limitId = expected || userId;
  const publishingLimit = limitId
    ? await get(`${encodeURIComponent(limitId)}/content_publishing_limit?fields=quota_usage,config`, token, base)
    : { status: 0, error: "No user id to ask about." };
  return {
    ok: !me.error && !publishingLimit.error,
    me,
    publishingLimit,
    username: me.data?.username as string | undefined,
    accountType: me.data?.account_type as string | undefined,
    userId,
    userIdMatches: expected ? userId === expected : null,
  };
}
