import { db } from "./db";
import type { Channel, EventKind } from "./ella";

/** Database access for the Instagram inbox. Server only. */

type Row = Record<string, unknown>;

/** "unsure": a send may or may not have reached Instagram (timeout, dropped connection). The owner checks and decides. */
export type DraftStatus = "pending" | "sending" | "approved" | "sent" | "unsure" | "dismissed";

export interface IgEvent {
  id: number;
  ext_id: string;
  source: "relay" | "manual";
  kind: EventKind;
  sender: string;
  sender_label: string;
  text: string;
  ref: string | null;
  parent: string | null;
  at: number;
  product_id: number | null;
  needs_owner: boolean;
  reason: string;
}

export interface IgDraft {
  id: number;
  event_id: number;
  channel: Channel;
  text: string;
  intents: string[];
  status: DraftStatus;
  error: string | null;
  sent_at: string | null;
}

const toEvent = (r: Row): IgEvent => ({
  id: Number(r.id),
  ext_id: String(r.ext_id),
  source: r.source === "manual" ? "manual" : "relay",
  kind: String(r.kind) as EventKind,
  sender: String(r.sender),
  sender_label: String(r.sender_label ?? ""),
  text: String(r.text ?? ""),
  ref: r.ref == null ? null : String(r.ref),
  parent: r.parent == null ? null : String(r.parent),
  at: Number(r.at),
  product_id: r.product_id == null ? null : Number(r.product_id),
  needs_owner: Number(r.needs_owner) === 1,
  reason: String(r.reason ?? ""),
});

const toDraft = (r: Row): IgDraft => {
  let intents: string[] = [];
  try { const v = JSON.parse(String(r.intents ?? "[]")); if (Array.isArray(v)) intents = v.map(String); } catch { /* keep empty */ }
  return {
    id: Number(r.id),
    event_id: Number(r.event_id),
    channel: String(r.channel) as Channel,
    text: String(r.text ?? ""),
    intents,
    status: String(r.status) as DraftStatus,
    error: r.error == null ? null : String(r.error),
    sent_at: r.sent_at == null ? null : String(r.sent_at),
  };
};

export interface NewEvent {
  ext_id: string;
  source: "relay" | "manual";
  relay_seq?: number | null;
  kind: EventKind;
  sender: string;
  sender_label?: string;
  text: string;
  ref?: string | null;
  parent?: string | null;
  at: number;
  product_id?: number | null;
}

/** Adds an event unless its id is already stored. Returns the stored event and whether it is new. */
export function addEvent(e: NewEvent): { event: IgEvent; created: boolean } {
  const d = db();
  const res = d
    .prepare(
      `INSERT OR IGNORE INTO ig_events (ext_id, source, relay_seq, kind, sender, sender_label, text, ref, parent, at, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(e.ext_id, e.source, e.relay_seq ?? null, e.kind, e.sender, e.sender_label ?? "", e.text, e.ref ?? null, e.parent ?? null, e.at, e.product_id ?? null);
  const row = d.prepare("SELECT * FROM ig_events WHERE ext_id = ?").get(e.ext_id) as Row;
  return { event: toEvent(row), created: Number(res.changes) > 0 };
}

export function getEvent(id: number): IgEvent | null {
  const r = db().prepare("SELECT * FROM ig_events WHERE id = ?").get(id) as Row | undefined;
  return r ? toEvent(r) : null;
}

export function setEventProduct(id: number, productId: number | null) {
  db().prepare("UPDATE ig_events SET product_id = ? WHERE id = ?").run(productId, id);
}

export function setEventFlag(id: number, needsOwner: boolean, reason: string) {
  db().prepare("UPDATE ig_events SET needs_owner = ?, reason = ? WHERE id = ?").run(needsOwner ? 1 : 0, reason, id);
}

export function addDraft(eventId: number, channel: Channel, text: string, intents: string[]): IgDraft {
  const res = db()
    .prepare("INSERT INTO ig_drafts (event_id, channel, text, intents) VALUES (?, ?, ?, ?)")
    .run(eventId, channel, text, JSON.stringify(intents));
  return getDraft(Number(res.lastInsertRowid))!;
}

export function getDraft(id: number): IgDraft | null {
  const r = db().prepare("SELECT * FROM ig_drafts WHERE id = ?").get(id) as Row | undefined;
  return r ? toDraft(r) : null;
}

export function draftsForEvent(eventId: number): IgDraft[] {
  return (db().prepare("SELECT * FROM ig_drafts WHERE event_id = ? ORDER BY id").all(eventId) as Row[]).map(toDraft);
}

/** Removes drafts that have not been acted on, so the writer can start again (for example after choosing a product). */
export function clearOpenDrafts(eventId: number) {
  db().prepare("DELETE FROM ig_drafts WHERE event_id = ? AND status IN ('pending', 'approved')").run(eventId);
}

export function updateDraft(id: number, patch: { text?: string; status?: DraftStatus; error?: string | null; sent?: boolean }) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.text !== undefined) { sets.push("text = ?"); vals.push(patch.text); }
  if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
  if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
  if (patch.sent) sets.push("sent_at = datetime('now')");
  if (!sets.length) return;
  db().prepare(`UPDATE ig_drafts SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id);
}

/** Atomically moves a draft into "sending" so a double click cannot send it twice. Returns false if it was not open. */
export function claimDraftForSending(id: number): boolean {
  const r = db()
    .prepare("UPDATE ig_drafts SET status = 'sending', error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('pending', 'approved')")
    .run(id);
  return Number(r.changes) === 1;
}

/**
 * True when a private reply to this comment was sent, is being sent, or may have been sent (Instagram allows one per comment).
 * "unsure" counts, because the reply might have gone through.
 */
export function privateReplySent(commentExtId: string): boolean {
  const r = db()
    .prepare(
      `SELECT 1 FROM ig_drafts d JOIN ig_events e ON e.id = d.event_id
       WHERE e.ext_id = ? AND d.channel = 'comment_private' AND d.status IN ('sending', 'sent', 'unsure') LIMIT 1`
    )
    .get(commentExtId);
  return Boolean(r);
}

/** Channels on this message that already went out, are going out, or may have gone out. A rewrite must not create a second copy. */
export function channelsAlreadyUsed(eventId: number): Set<string> {
  const rows = db()
    .prepare("SELECT DISTINCT channel FROM ig_drafts WHERE event_id = ? AND status IN ('sending', 'sent', 'unsure')")
    .all(eventId) as Row[];
  return new Set(rows.map((r) => String(r.channel)));
}

/**
 * A send that has been "sending" for over two minutes was interrupted (the app stopped, or the answer never came back).
 * Whether it reached Instagram is unknown, so it becomes "unsure" and the owner decides, instead of being stuck forever.
 */
export function reapStuckSending() {
  db()
    .prepare(
      `UPDATE ig_drafts SET status = 'unsure', updated_at = datetime('now'),
         error = 'The send was interrupted, so it may or may not have gone through. Check Instagram, then choose below.'
       WHERE status = 'sending' AND updated_at < datetime('now', '-2 minutes')`
    )
    .run();
}

export interface Thread {
  sender: string;
  label: string;
  last_at: number;
  last_text: string;
  messages: number;
  open_drafts: number;
  needs_owner: boolean;
}

/** One row per customer, newest first. Only the latest 1000 messages are considered. */
export function listThreads(): Thread[] {
  reapStuckSending();
  const events = (db().prepare("SELECT * FROM ig_events ORDER BY at DESC, id DESC LIMIT 1000").all() as Row[]).map(toEvent);
  const open = new Map<number, number>();
  for (const r of db().prepare("SELECT event_id, COUNT(*) AS n FROM ig_drafts WHERE status IN ('pending', 'approved', 'sending', 'unsure') GROUP BY event_id").all() as Row[]) {
    open.set(Number(r.event_id), Number(r.n));
  }
  const threads = new Map<string, Thread>();
  for (const e of events) {
    const open_here = open.get(e.id) ?? 0;
    const t = threads.get(e.sender);
    if (!t) {
      threads.set(e.sender, {
        sender: e.sender, label: e.sender_label || `Customer …${e.sender.slice(-4)}`, last_at: e.at, last_text: e.text,
        messages: 1, open_drafts: open_here, needs_owner: e.needs_owner && open_here > 0,
      });
    } else {
      t.messages += 1;
      t.open_drafts += open_here;
      if (e.needs_owner && open_here > 0) t.needs_owner = true;
      if (t.label.startsWith("Customer …") && e.sender_label) t.label = e.sender_label;
    }
  }
  return [...threads.values()];
}

export function threadEvents(sender: string): { event: IgEvent; drafts: IgDraft[] }[] {
  reapStuckSending();
  const events = (db().prepare("SELECT * FROM ig_events WHERE sender = ? ORDER BY at, id LIMIT 200").all(sender) as Row[]).map(toEvent);
  return events.map((event) => ({ event, drafts: draftsForEvent(event.id) }));
}

/** The product this customer was last talking about (within 3 days), so "what sizes?" after naming a piece still works. */
export function lastProductForSender(sender: string, beforeAt: number): number | null {
  const r = db()
    .prepare("SELECT product_id FROM ig_events WHERE sender = ? AND product_id IS NOT NULL AND at < ? AND at > ? ORDER BY at DESC LIMIT 1")
    .get(sender, beforeAt, beforeAt - 3 * 24 * 3600 * 1000) as Row | undefined;
  return r ? Number(r.product_id) : null;
}

export function openDraftCount(): number {
  const r = db().prepare("SELECT COUNT(*) AS n FROM ig_drafts WHERE status IN ('pending', 'approved', 'unsure')").get() as Row;
  return Number(r.n);
}

export function getState(key: string): string | null {
  const r = db().prepare("SELECT value FROM ig_state WHERE key = ?").get(key) as Row | undefined;
  return r ? String(r.value) : null;
}

export function setState(key: string, value: string) {
  db().prepare("INSERT INTO ig_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
