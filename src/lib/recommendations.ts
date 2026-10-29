import { z } from "zod";
import { scanText } from "./claims";
import type { Draft } from "./kitDraft";

/**
 * Market research for one kit (price range of similar items, description ideas, product facts to confirm), shown in the
 * Recommendations panel on the Instagram page. The file instagram/<kit>/recommendations.json is written outside the Studio
 * (by Claude in the project chat, from the owner's connectors), so every line is untrusted: a line with banned wording or
 * anything that looks like another brand is dropped, just that line. Nothing here ever fills a field by itself; the panel's
 * buttons do, one at a time. Pure, so the page and the server use the same checks.
 */

const Num = z.number().finite().nonnegative();
const Text = z.string().max(400);

const Raw = z.object({
  generatedAt: z.string().max(40),
  price: z.object({ currency: z.string().max(5), low: Num, median: Num, high: Num, count: z.number().int().nonnegative(), note: Text.default("") }).nullable().default(null),
  suggestedPriceCAD: z.object({ low: Num, high: Num, note: Text.default("") }).nullable().default(null),
  descriptionIdeas: z.array(Text).max(20).default([]),
  productFacts: z.array(z.object({ label: z.string().max(80), value: z.string().max(200), confirmed: z.boolean() })).max(30).default([]),
  toConfirm: z.array(Text).max(20).default([]),
  sources: z.array(Text).max(10).default([]),
});

export type Recommendations = z.infer<typeof Raw>;

export type RecommendationsResult =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "ok"; data: Recommendations; dropped: number };

/** Wording that borrows another brand, without naming any: marks like ® and ™, "& Co", and the usual copy words. */
const BRANDISH = /[®™©]|&\s?co\b|\bdupes?\b|\binspired\b|\breplica|\blook[- ]?alike|\blook for less\b|\bdesigner\b|\bluxury\b|\bauthentic\b|\bgenuine\b|\bin the style of\b/i;

/** A line may be shown when it has no banned claim and borrows no brand. */
export const lineOk = (s: string) => !s || (!BRANDISH.test(s) && scanText(s).length === 0);

/** Reads and checks the file's contents. Unknown fields are ignored; any bad line is dropped and counted. */
export function readRecommendations(raw: unknown): RecommendationsResult {
  if (raw === null || raw === undefined) return { status: "none" };
  const p = Raw.safeParse(raw);
  if (!p.success) return { status: "invalid" };
  const d = p.data;
  let dropped = 0;
  const keep = (list: string[]) => list.filter((s) => (lineOk(s) ? true : (dropped++, false)));
  const note = (s: string) => (lineOk(s) ? s : (dropped++, ""));
  const range = <T extends { low: number; high: number }>(r: T | null) => (r && r.low <= r.high ? r : null);
  const price = range(d.price);
  const suggested = range(d.suggestedPriceCAD);
  const data: Recommendations = {
    generatedAt: d.generatedAt,
    price: price && { ...price, median: Math.min(price.high, Math.max(price.low, price.median)), note: note(price.note) },
    suggestedPriceCAD: suggested && { ...suggested, note: note(suggested.note) },
    descriptionIdeas: keep(d.descriptionIdeas),
    productFacts: d.productFacts.filter((f) => (lineOk(f.label) && lineOk(f.value) ? true : (dropped++, false))),
    toConfirm: keep(d.toConfirm),
    sources: keep(d.sources),
  };
  // Counted only after every line has been checked.
  return { status: "ok", dropped, data };
}

// ---- What the panel's buttons do. Each returns the change for one field; nothing is ever posted from here.

/** "Use $X": the price field only. */
export const usePrice = (n: number): Partial<Draft["fields"]> => ({ price: Number.isInteger(n) ? String(n) : n.toFixed(2) });

/** "Add to caption": the idea goes in as its own line just above the price line (or at the end when there is none). */
export function addToCaption(caption: string, idea: string): string {
  const text = caption.trimEnd();
  const i = text.lastIndexOf("\n\n");
  if (i >= 0 && /\$\[?PRICE\]?|\$\d/.test(text.slice(i))) return `${text.slice(0, i)}\n\n${idea}${text.slice(i)}`;
  return text ? `${text}\n\n${idea}` : idea;
}

/** "Fill": a confirmed fact with a value goes into its matching More options field, if there is one. */
export function fillFromFact(f: { label: string; value: string; confirmed: boolean }): Partial<Draft["fields"]> | null {
  if (!f.value.trim()) return null;
  if (/chain|length/i.test(f.label)) return { length: f.value.trim() };
  if (/order/i.test(f.label)) return { order: f.value.trim() };
  return null;
}

/** Where a price sits on the suggested range, 0 to 1 (clamped), for the marker on the bar. */
export const pricePosition = (price: number, low: number, high: number) => (high > low ? Math.min(1, Math.max(0, (price - low) / (high - low))) : 0.5);
