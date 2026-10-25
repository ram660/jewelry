import { z } from "zod";
import { relayUrl } from "../config";

/** Collects new customer messages from the public relay (see relay/ and docs/INSTAGRAM.md). Outbound requests only. */

const Event = z.object({
  seq: z.number().int(),
  id: z.string().min(1).max(200),
  kind: z.enum(["dm", "comment", "story_reply", "story_mention", "postback"]),
  account: z.string().max(100),
  from: z.string().min(1).max(100),
  text: z.string().max(2000),
  ref: z.string().max(200).optional(),
  parent: z.string().max(200).optional(),
  at: z.number().int().positive(),
});
// `epoch` identifies one life of the relay's database. If it changes, the relay was reset and its numbering started over.
const Reply = z.object({ events: z.array(Event).max(200), next: z.number().int(), epoch: z.string().max(100).optional() });

export type RelayEvent = z.infer<typeof Event>;

/** The relay must be https, except on this computer for testing. */
function checkedBase(): string {
  const base = relayUrl();
  let u: URL;
  try { u = new URL(base); } catch { throw new Error("RELAY_URL is not a valid address."); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !local) throw new Error("RELAY_URL must start with https:// (plain http is only allowed for localhost).");
  return base;
}

export async function pullRelay(after: number, limit = 100): Promise<{ events: RelayEvent[]; next: number; epoch?: string }> {
  const token = process.env.RELAY_PULL_TOKEN;
  if (!token) throw new Error("RELAY_PULL_TOKEN is not set in .env.local.");
  let res: Response;
  try {
    res = await fetch(`${checkedBase()}/events?after=${Math.max(0, Math.trunc(after))}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Could not reach the relay: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401) throw new Error("The relay rejected the pull token. Check RELAY_PULL_TOKEN.");
  if (!res.ok) throw new Error(`The relay answered with an error (${res.status}).`);
  const parsed = Reply.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error("The relay sent a reply this version does not understand.");
  return parsed.data;
}
