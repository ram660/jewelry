import { postProblems } from "./postNotes";
import type { Draft } from "./kitDraft";

/**
 * The Reel styles "Create Reel" rotates through, and how it picks the next style, track and price card. Pure, so the page
 * shows the same names the server uses, and the rules can be tested without ffmpeg.
 */

export const RECIPES = [
  { id: "zoom", label: "Slow zoom" },
  { id: "quick", label: "Quick cuts" },
  { id: "push", label: "Slide and push" },
  { id: "reveal", label: "Close-up reveal" },
  { id: "kenburns", label: "Pan and price card" },
] as const;
export type RecipeId = (typeof RECIPES)[number]["id"];
export const recipeLabel = (id: string) => RECIPES.find((r) => r.id === id)?.label ?? id;

/** A different style from the last one, picked at random from the rest. */
export function nextRecipe(last: string | null | undefined, rand: () => number = Math.random): RecipeId {
  const pool = RECIPES.map((r) => r.id).filter((id) => id !== last);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export type TrackPick = { track: string | null } | { error: string };

/**
 * The music for the next Reel: none when muted; otherwise a different track from the last one when there is more than one.
 * With no tracks at all it says what to do, rather than making a silent Reel the owner didn't ask for.
 */
export function nextTrack(tracks: string[], last: string | null | undefined, mute: boolean, rand: () => number = Math.random): TrackPick {
  if (mute) return { track: null };
  if (!tracks.length) return { error: "There's no music in the audio folder yet. Add an MP3 there, or tick Mute to make a Reel without sound." };
  const pool = tracks.length > 1 ? tracks.filter((t) => t !== last) : tracks;
  return { track: pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] };
}

/** Emoji and other symbols the card's font can't draw. */
const SYMBOLS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/**
 * The words on the closing price card: the typed price and the order line, as plain text. Null (no card) when no price
 * is typed, or when the text has a blank or breaks the wording rules.
 */
export function priceCard(fields: Draft["fields"]): { price: string; order: string } | null {
  const n = Number(fields.price.trim().replace(/^\$/, "").replace(/\s*CAD$/i, "").replace(/,/g, ""));
  if (!(n > 0)) return null;
  const price = `$${Number.isInteger(n) ? n : n.toFixed(2)} CAD`;
  const order = fields.order.replace(SYMBOLS, "").replace(/\s{2,}/g, " ").trim().slice(0, 80);
  if (postProblems([price, order].join("\n")).length) return null;
  return { price, order };
}
