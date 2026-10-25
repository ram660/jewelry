import crypto from "node:crypto";
import { getProduct, listProducts } from "./db";
import { draftReplies, findProduct, type EventKind } from "./ella";
import { scanText } from "./claims";
import { igSendMode, igTokenConfigured, relayConfigured } from "./config";
import { planSend } from "./sendrules";
import { pullRelay } from "./providers/relay";
import { replyToComment, sendDm, sendPrivateReply } from "./providers/instagram";
import {
  addDraft, addEvent, channelsAlreadyUsed, claimDraftForSending, clearOpenDrafts, getDraft, getEvent, getState,
  lastProductForSender, privateReplySent, setEventFlag, setEventProduct, setState, updateDraft,
} from "./inbox";

/** The inbox workflow: pull messages, write drafts, send approved replies. Server only. */

/** Writes (or rewrites) the draft replies for one customer message. Drafts already sent or dismissed are kept. */
export function draftForEvent(eventId: number): void {
  const event = getEvent(eventId);
  if (!event) return;

  // Which product? Explicit choice first, then a name or SKU in the message, then what this customer was last talking about.
  let productId = event.product_id;
  if (productId == null) {
    productId = findProduct(event.text, listProducts().map((p) => ({ id: p.id, name: p.name, sku: p.sku })));
    if (productId == null) productId = lastProductForSender(event.sender, event.at);
    if (productId != null) setEventProduct(eventId, productId);
  }
  const product = productId != null ? getProduct(productId) : null;

  const result = draftReplies({ text: event.text, kind: event.kind, product });
  clearOpenDrafts(eventId);
  // Never create a second reply for a channel that already went out, is going out, or may have gone out.
  const used = channelsAlreadyUsed(eventId);
  for (const d of result.drafts) if (!used.has(d.channel)) addDraft(eventId, d.channel, d.text, result.intents);
  setEventFlag(eventId, result.needsOwner, result.reason);
}

const g = globalThis as unknown as { __efjSyncing?: boolean };

export interface SyncResult { received: number; fresh: number; }

/** Pulls new messages from the relay and drafts replies for them. One sync at a time. */
export async function syncRelay(): Promise<SyncResult> {
  if (!relayConfigured()) throw new Error("The relay is not set up. Add RELAY_URL and RELAY_PULL_TOKEN to .env.local.");
  if (g.__efjSyncing) return { received: 0, fresh: 0 };
  g.__efjSyncing = true;
  try {
    let received = 0;
    let fresh = 0;
    let cursor = Number(getState("relay_cursor") ?? 0) || 0;
    for (let page = 0; page < 10; page++) {
      let reply = await pullRelay(cursor, 100);
      // A relay whose database was reset starts numbering from 1 again. Its "epoch" changes, and we start over from the
      // beginning. Messages we already stored are skipped by their Instagram id, so nothing is duplicated.
      const known = getState("relay_epoch");
      if (reply.epoch && known && reply.epoch !== known) {
        cursor = 0;
        setState("relay_cursor", "0");
        reply = await pullRelay(0, 100);
      }
      if (reply.epoch && reply.epoch !== known) setState("relay_epoch", reply.epoch);
      const { events, next } = reply;
      for (const e of events) {
        received++;
        const { event, created } = addEvent({
          ext_id: e.id, source: "relay", relay_seq: e.seq, kind: e.kind, sender: e.from, text: e.text,
          ref: e.ref ?? null, parent: e.parent ?? null,
          // A message cannot be from the future. Clamping keeps a bad timestamp from holding Instagram's reply window open.
          at: Math.min(e.at, Date.now()),
        });
        if (!created) continue;
        fresh++;
        try {
          draftForEvent(event.id);
        } catch {
          // One message we cannot draft for must not block the ones behind it. It is flagged so the owner answers it.
          setEventFlag(event.id, true, "Could not write a draft for this message. Please answer it yourself.");
        }
      }
      // Move the position only after every event of the page is stored, so a crash re-reads rather than skips.
      if (next > cursor) { cursor = next; setState("relay_cursor", String(cursor)); }
      if (events.length < 100) break;
    }
    return { received, fresh };
  } finally {
    g.__efjSyncing = false;
  }
}

/** A message the owner pastes in by hand (for example a DM read in the Instagram app). Works with no relay at all. */
export function addManual(o: { kind: "dm" | "comment"; label: string; text: string; productId?: number | null }) {
  const label = o.label.trim().slice(0, 60) || "Customer";
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
  const { event } = addEvent({
    ext_id: `manual:${crypto.randomUUID()}`, source: "manual", kind: o.kind as EventKind, sender: `manual:${slug}`,
    sender_label: label, text: o.text.trim(), at: Date.now(), product_id: o.productId ?? null,
  });
  draftForEvent(event.id);
  return event;
}

export interface SendOutcome {
  ok: boolean;
  how: "api" | "copy" | "blocked" | "refused";
  message: string;
}

/**
 * Approves a draft and, when live sending is on and allowed, sends it. Safe to call twice: a draft that is already
 * being sent or was sent is refused. The text is re-checked for banned wording here, whatever was typed into the box.
 */
export async function sendDraft(draftId: number): Promise<SendOutcome> {
  const draft = getDraft(draftId);
  if (!draft) return { ok: false, how: "refused", message: "That draft no longer exists." };
  if (draft.status !== "pending" && draft.status !== "approved") {
    return { ok: false, how: "refused", message: `This draft is already ${draft.status}.` };
  }
  const text = draft.text.trim();
  if (!text) return { ok: false, how: "refused", message: "The reply is empty." };
  if (text.length > 1000) return { ok: false, how: "refused", message: "Instagram replies are limited to 1000 characters." };

  const event = getEvent(draft.event_id);
  if (!event) return { ok: false, how: "refused", message: "The customer's message no longer exists." };
  const product = event.product_id != null ? getProduct(event.product_id) : null;
  const problems = scanText(text, { hypoallergenic: product?.hypoallergenic, nickel_free: product?.nickel_free });
  if (problems.length) {
    return { ok: false, how: "refused", message: `This reply contains wording we do not allow: ${problems.join("; ")}. Change it first.` };
  }

  const plan = planSend({
    channel: draft.channel, source: event.source, eventAt: event.at, now: Date.now(), mode: igSendMode(),
    hasToken: igTokenConfigured(), privateAlreadySent: draft.channel === "comment_private" && privateReplySent(event.ext_id),
  });
  if (plan.how === "copy") {
    updateDraft(draftId, { status: "approved", error: null });
    return { ok: true, how: "copy", message: plan.why };
  }
  if (plan.how === "blocked") return { ok: false, how: "blocked", message: plan.why };

  if (!claimDraftForSending(draftId)) return { ok: false, how: "refused", message: "This draft is already being sent." };
  const result =
    draft.channel === "dm" ? await sendDm(event.sender, text)
    : draft.channel === "comment_private" ? await sendPrivateReply(event.ext_id, text)
    // Instagram only allows public replies under a top-level comment. If this comment is itself a reply, reply to its parent.
    : await replyToComment(event.parent ?? event.ext_id, text);
  if (!result.ok) {
    const error = result.error ?? "Instagram did not accept the reply.";
    // A clear refusal means it was not sent, so the owner can fix and retry. If we cannot tell, it may have gone out,
    // and sending it again could reach the customer twice, so the owner checks Instagram first.
    updateDraft(draftId, { status: result.unknown ? "unsure" : "pending", error });
    return { ok: false, how: "api", message: error };
  }
  updateDraft(draftId, { status: "sent", sent: true, error: null });
  return { ok: true, how: "api", message: "Sent." };
}
