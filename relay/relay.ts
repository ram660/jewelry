/**
 * Instagram webhook relay. The only part of EFJ Studio that is ever reachable from the internet.
 *
 * It does three things and nothing else:
 *   1. answers Meta's one-time handshake,
 *   2. checks the signature on every delivery, drops duplicates and queues the events,
 *   3. lets the Studio (which stays private, on the owner's computer) pull the queue with a secret token.
 *
 * It holds no access token, no catalog and no AI key, so a leak here cannot post, message or read anything.
 * Standard Request/Response only (no Node imports), so it runs on Node, Vercel, Cloudflare or Deno.
 */

export type EventKind = "dm" | "comment" | "story_reply" | "story_mention" | "postback";

export interface RelayEvent {
  /** Unique per event, from Instagram (message id or comment id). The queue ignores a second event with the same id. */
  id: string;
  kind: EventKind;
  /** Our Instagram business account id (the account that received it). */
  account: string;
  /** The customer's Instagram-scoped id. */
  from: string;
  text: string;
  /** Media id (comments) or story id (story replies), when there is one. */
  ref?: string;
  /** Parent comment id when this comment is a reply. */
  parent?: string;
  /** Unix milliseconds. */
  at: number;
}

export interface StoredEvent extends RelayEvent {
  seq: number;
}

export interface Store {
  /** Adds events, ignoring ids already stored. Returns how many were new. */
  add(events: RelayEvent[]): Promise<number>;
  /** Events with seq greater than `afterSeq`, oldest first. */
  list(afterSeq: number, limit: number): Promise<StoredEvent[]>;
  /** Deletes events received before this time. */
  prune(beforeMs: number): Promise<void>;
  /**
   * An id for this queue's life. It is created once and kept with the data, so it changes only if the queue is wiped or
   * replaced. The Studio uses it to notice that sequence numbers started over.
   */
  epoch(): Promise<string>;
}

export interface RelayConfig {
  /** Instagram app secret and/or Meta app secret. Meta signs with one of them depending on app setup. */
  appSecrets: string[];
  verifyToken: string;
  pullToken: string;
  store: Store;
  now?: () => number;
  maxBodyBytes?: number;
  retentionMs?: number;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

/** Constant-time string comparison (hashes both sides first so length differences do not leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

/** Meta signs the raw body with HMAC-SHA256 and sends `sha256=<hex>` in X-Hub-Signature-256. There is no bypass switch. */
export async function verifySignature(rawBody: string, header: string | null, secrets: string[]): Promise<boolean> {
  if (!header || !header.startsWith("sha256=") || secrets.length === 0) return false;
  const received = header.slice(7).toLowerCase();
  let ok = false;
  for (const s of secrets) {
    if (!s) continue;
    // Evaluate every secret so timing does not reveal which one matched.
    if (await safeEqual(received, await hmacHex(s, rawBody))) ok = true;
  }
  return ok;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const MAX_TEXT = 2000;

/** Turns a Meta webhook payload into plain events. Echoes, read receipts, deliveries and reactions are dropped. */
export function parseWebhook(payload: unknown, receivedAt: number): RelayEvent[] {
  const out: RelayEvent[] = [];
  const entries = obj(payload).entry;
  if (!Array.isArray(entries)) return out;

  for (const e of entries) {
    const entry = obj(e);
    const account = str(entry.id);

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const ev = obj(m);
      const sender = str(obj(ev.sender).id);
      const recipient = str(obj(ev.recipient).id);
      if (!sender || sender === recipient || sender === account) continue; // our own messages
      if (ev.read || ev.delivery || ev.reaction) continue;
      const at = Number(ev.timestamp) || receivedAt;

      if (ev.postback) {
        const payloadText = str(obj(ev.postback).payload);
        out.push({ id: `pb:${sender}:${at}:${payloadText}`, kind: "postback", account, from: sender, text: payloadText.slice(0, MAX_TEXT), at });
        continue;
      }
      const msg = obj(ev.message);
      if (msg.is_echo) continue;
      const mid = str(msg.mid);
      if (!mid) continue;
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
      const story = obj(obj(msg.reply_to).story);
      let kind: EventKind = "dm";
      let ref: string | undefined;
      if (obj(attachments[0]).type === "story_mention") {
        kind = "story_mention";
      } else if (str(story.id)) {
        kind = "story_reply";
        ref = str(story.id);
      }
      out.push({ id: mid, kind, account, from: sender, text: str(msg.text).slice(0, MAX_TEXT), ref, at });
    }

    for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
      const ch = obj(c);
      if (ch.field !== "comments") continue;
      const v = obj(ch.value);
      const id = str(v.id);
      const from = str(obj(v.from).id);
      const text = str(v.text);
      if (!id || !from || from === account || !text) continue;
      out.push({
        id, kind: "comment", account, from, text: text.slice(0, MAX_TEXT),
        ref: str(obj(v.media).id) || undefined, parent: str(v.parent_id) || undefined, at: receivedAt,
      });
    }
  }
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function createRelay(cfg: RelayConfig): (req: Request) => Promise<Response> {
  const now = cfg.now ?? Date.now;
  const maxBody = cfg.maxBodyBytes ?? 256 * 1024;
  const retention = cfg.retentionMs ?? 7 * 24 * 3600 * 1000;
  // Missing secrets must never mean "open". With no configuration every request is refused.
  const configured = cfg.appSecrets.some(Boolean) && !!cfg.verifyToken && !!cfg.pullToken;

  return async (req) => {
    if (!configured) return json({ error: "Relay is not configured." }, 503);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (path.endsWith("/webhook") && req.method === "GET") {
      const ok =
        url.searchParams.get("hub.mode") === "subscribe" &&
        (await safeEqual(url.searchParams.get("hub.verify_token") ?? "", cfg.verifyToken));
      const challenge = url.searchParams.get("hub.challenge");
      return ok && challenge ? new Response(challenge, { status: 200 }) : json({ error: "Forbidden" }, 403);
    }

    if (path.endsWith("/webhook") && req.method === "POST") {
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > maxBody) return json({ error: "Too large" }, 413);
      const raw = await req.text();
      if (raw.length > maxBody) return json({ error: "Too large" }, 413);
      if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecrets))) {
        return json({ error: "Invalid signature" }, 401);
      }
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }
      const events = parseWebhook(payload, now());
      try {
        const added = await cfg.store.add(events);
        await cfg.store.prune(now() - retention);
        return json({ ok: true, received: events.length, new: added });
      } catch {
        // A 500 makes Meta retry the delivery. The queue ignores the duplicates that retry brings.
        return json({ error: "Could not store events" }, 500);
      }
    }

    if (path.endsWith("/events") && req.method === "GET") {
      const auth = req.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ") || !(await safeEqual(auth.slice(7), cfg.pullToken))) {
        return json({ error: "Unauthorized" }, 401);
      }
      const after = Math.max(0, Math.trunc(Number(url.searchParams.get("after")) || 0));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || 50)));
      const events = await cfg.store.list(after, limit);
      return json({ events, next: events.length ? events[events.length - 1].seq : after, epoch: await cfg.store.epoch() });
    }

    return json({ error: "Not found" }, 404);
  };
}

/**
 * In-memory queue for tests and local trials. It forgets everything when the process restarts (and on every cold start of a
 * serverless host), so do not use it for the real relay. Use SqliteStore on a machine with a disk.
 */
export class MemoryStore implements Store {
  private rows: (StoredEvent & { receivedAt: number })[] = [];
  private seq = 0;
  private id = crypto.randomUUID();
  async epoch(): Promise<string> {
    return this.id;
  }
  async add(events: RelayEvent[]): Promise<number> {
    let n = 0;
    for (const e of events) {
      if (this.rows.some((r) => r.id === e.id)) continue;
      this.rows.push({ ...e, seq: ++this.seq, receivedAt: Date.now() });
      n++;
    }
    return n;
  }
  async list(afterSeq: number, limit: number): Promise<StoredEvent[]> {
    return this.rows.filter((r) => r.seq > afterSeq).slice(0, limit).map(({ receivedAt: _r, ...e }) => e);
  }
  async prune(beforeMs: number): Promise<void> {
    this.rows = this.rows.filter((r) => r.receivedAt >= beforeMs);
  }
}
