import type { Channel } from "./ella.ts";

/** Instagram's limits on replying. Pure, so they can be tested without any network. */
export const DM_WINDOW_MS = 24 * 3600 * 1000; // a DM reply must follow the customer's last message within 24 hours
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000; // a private reply to a comment, within 7 days, once per comment

export type SendPlan =
  | { how: "api" }
  /** Approve here, then send it by hand in the Instagram app. */
  | { how: "copy"; why: string }
  | { how: "blocked"; why: string };

export function planSend(o: {
  channel: Channel;
  source: "relay" | "manual";
  eventAt: number;
  now: number;
  mode: "off" | "live";
  hasToken: boolean;
  privateAlreadySent: boolean;
}): SendPlan {
  if (o.mode === "off") return { how: "copy", why: "Sending is off (draft-only mode). Copy the reply and send it in the Instagram app." };
  if (o.source === "manual") return { how: "copy", why: "This message was added by hand, so it can only be answered in the Instagram app." };
  if (!o.hasToken) return { how: "blocked", why: "No Instagram access token is set in .env.local." };

  const age = o.now - o.eventAt;
  if (o.channel === "dm" && age > DM_WINDOW_MS) {
    return { how: "blocked", why: "It has been more than 24 hours since the customer wrote. Instagram does not allow an automated reply now. Reply in the Instagram app." };
  }
  if (o.channel === "comment_private") {
    if (age > PRIVATE_REPLY_WINDOW_MS) return { how: "blocked", why: "Private replies to a comment must be sent within 7 days." };
    if (o.privateAlreadySent) return { how: "blocked", why: "Instagram allows only one private reply per comment, and one was already sent." };
  }
  return { how: "api" };
}
