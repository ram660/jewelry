import type { Product } from "./types";

/**
 * Pure functions, safe to run in the browser and on the server (no Node imports).
 * This file is the one canonical list of wording we do not allow. BRAND.md, KNOWLEDGE_BASE.md, the AI prompt in
 * ai.ts and the catalog-photos skill describe the same rules in words; when they disagree, this file wins.
 */

export interface Problem {
  level: "block" | "warn";
  message: string;
}

/** Owner-confirmed facts that unlock a claim. Anything other than `true` keeps the claim blocked. */
export interface Facts {
  hypoallergenic?: boolean | null;
  nickel_free?: boolean | null;
}

interface Rule {
  re: RegExp;
  msg: string;
  /** The rule is skipped when this fact is `true` on the product record. */
  unless?: keyof Facts;
}

/** Make look-alike text comparable: Unicode compatibility forms, invisible characters, curly quotes, K look-alikes. */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[­​-‍﻿]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[ΚК]/g, "K"); // Greek Kappa, Cyrillic Ka
}

// Phrases that misdescribe 10K gold-plated jewellery (see docs/BRAND.md and KNOWLEDGE_BASE.md).
const BLOCK_RULES: Rule[] = [
  // "It isn't solid gold" is the honest answer we want customers to hear, so a direct negation just before it is allowed.
  { re: /(?<!\b(?:not|never|isn'?t|is\s+not|aren'?t|are\s+not)\s+)\bsolid[\s-]+gold\b/i, msg: "“solid gold”: the pieces are gold-plated" },
  {
    re: /\b(?:real|genuine|pure|authentic|true|actual|fine|premium|luxury)\s+(?:10[\s-]?k(?:t)?\s+)?gold\b(?![\s-]*plat)/i,
    msg: "“real/genuine/pure gold”: say “10K gold-plated”",
  },
  { re: /\b100\s?%\s*gold\b|\ball[\s-]gold\b|\bgold\s+throughout\b/i, msg: "a claim that the piece is all gold" },
  {
    re: /\b10[\s-]?(?:k|kt|karat|carat|ct)\b(?![\s-]*(?:gold[\s-]*)?(?:plat|gp\b))/i,
    msg: "“10K” without “plated”: say “10K gold-plated”",
  },
  { re: /\b(?:9|12|14|15|18|20|21|22|24)[\s-]?(?:k|kt|karat|carat|ct)\b/i, msg: "a karat other than 10K" },
  {
    re: /\bwater[\s-]?(?:proof|resistant|repellent|safe)\b|\b(?:splash|sweat|rain|shower|swim)[\s-]?(?:proof|resistant|safe)\b|\bsafe\s+(?:to|for)\s+(?:the\s+)?(?:shower|showering|swim|swimming)\b/i,
    msg: "a water-resistance claim: plated jewellery should avoid water",
  },
  {
    re: /\btarnish[\s-]?(?:free|proof|resistant)\b|\b(?:doesn'?t|does\s+not|won'?t|will\s+not|never|non|no)[\s-]+tarnish/i,
    msg: "a tarnish-free claim",
  },
  {
    re: /\bfade[\s-]?(?:free|proof|resistant)\b|\b(?:doesn'?t|does\s+not|won'?t|will\s+not|never|non)[\s-]+(?:fade|fades|fading|discolou?r\w*|rust|peel\w*|chip\w*|flake\w*)/i,
    msg: "a will-not-fade claim",
  },
  {
    re: /\blasts?\s+(?:forever|a\s+lifetime|for\s+(?:a\s+)?(?:lifetime|years|ever))\b|\blifetime\b|\bever[\s-]?lasting\b|\bnever\s+wears?\s+off\b|\bheirloom\b|\bbuilt\s+to\s+last\b/i,
    msg: "a lasts-forever claim",
  },
  {
    re: /\bhypo[\s-]?allergenic\b/i,
    msg: "“hypoallergenic”: only claim it with a supplier certificate (set the Hypoallergenic field)",
    unless: "hypoallergenic",
  },
  {
    re: /\ballerg(?:y|en)[\s-]?(?:free|friendly|safe)\b|\bnon[\s-]?(?:allergenic|irritating)\b|\bskin[\s-]?safe\b|\bsafe\s+for\s+sensitive\s+skin\b|\b(?:won'?t|will\s+not|doesn'?t|does\s+not)\s+(?:irritate|turn\s+(?:your\s+)?(?:skin|fingers?)\s+green)\b|\bdermatolog/i,
    msg: "a skin-safety claim: hand skin questions to the owner",
    unless: "hypoallergenic",
  },
  {
    re: /\bnickel[\s-]?free\b/i,
    msg: "“nickel-free”: only claim it when the Nickel-free field is set from a supplier certificate",
    unless: "nickel_free",
  },
];

// Not blocked, but worth a second look before posting.
const WARN_RULES: Rule[] = [
  { re: /\bforever\b/i, msg: "“forever”: do not imply the plating lasts forever" },
  { re: /\bguarantee[sd]?\b/i, msg: "“guarantee”: only promise what the written policy says" },
  { re: /\b(?:lead|cadmium)[\s-]?free\b/i, msg: "“lead/cadmium-free”: only with a supplier certificate" },
  {
    re: /\b(?:vermeil|gold[\s-]?filled|sterling|surgical|moissanite)\b/i,
    msg: "a metal or stone name the owner has not confirmed",
  },
];

/** The owner-confirmed facts on a product record that unlock a claim. */
export const claimContext = (p: Pick<Product, "nickel_free" | "hypoallergenic">): Facts => ({ hypoallergenic: p.hypoallergenic, nickel_free: p.nickel_free });

/** Banned-wording messages found in `text`. Pass the product's confirmed facts to unlock claims they support. */
export function scanText(text: string, facts: Facts = {}): string[] {
  if (!text) return [];
  const t = normaliseText(String(text));
  return BLOCK_RULES.filter((r) => !(r.unless && facts[r.unless] === true) && r.re.test(t)).map((r) => r.msg);
}

function scanWarnings(text: string): string[] {
  if (!text) return [];
  const t = normaliseText(String(text));
  return WARN_RULES.filter((r) => r.re.test(t)).map((r) => r.msg);
}

// Hashtags have no spaces, so "#solidgold" would slip past the word-based rules above.
const TAG_BLOCK: [RegExp, string][] = [
  [/(?:solid|real|pure|genuine|authentic)gold/, "a real/solid gold claim"],
  [/waterproof|waterresistant/, "a water-resistance claim"],
  [/tarnish(?:free|proof)|neverfade|fadeproof/, "a tarnish-free claim"],
  [/hypoallergenic|allergyfree/, "a hypoallergenic claim"],
  [/lifetime|everlasting|lastsforever/, "a lasts-forever claim"],
  [/(?<![0-9])(?:9|12|14|15|18|20|21|22|24)k(?:t|arat)?(?:gold|$)/, "a karat other than 10K"],
  [/(?<![0-9])10k(?:t|arat)?gold(?!plated|gp)/, "“10K gold” without “plated”"],
];

export function scanHashtag(tag: string, facts: Facts = {}): string[] {
  const compact = normaliseText(String(tag ?? "")).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compact) return [];
  return TAG_BLOCK.filter(
    ([re, msg]) => !(facts.hypoallergenic === true && /hypoallergenic/.test(msg)) && re.test(compact)
  ).map(([, msg]) => msg);
}

const DEMO_MARK = /\[DEMO\]/i;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

/** Every piece of text that can reach a customer, with a label for messages. */
function publishedText(p: Product): [string, string][] {
  const one = (label: string, v: unknown): [string, string][] => [[label, String(v ?? "")]];
  const many = (label: string, v: unknown): [string, string][] => strings(v).map((s, i) => [`${label} ${i + 1}`, s]);
  return [
    ...one("Name", p.name),
    ...one("Short description", p.short_desc),
    ...one("Full description", p.long_desc),
    ...one("Care notes", p.care_notes),
    ...one("Alt text", p.alt_text),
    ...one("Plating", p.plating),
    ...one("Subcategory", p.subcategory),
    ...one("Colour / finish", p.colour_finish),
    ...one("Stones", p.stones),
    ...one("Sizes", p.sizes),
    ...many("Caption", p.captions),
    ...many("Name suggestion", p.name_suggestions),
    ...many("Style tag", p.style_tags),
    ...many("Occasion tag", p.occasion_tags),
  ];
}

/** Blocking text problems only (banned wording, placeholders). Used by the carousel export and the ready check. */
export function claimProblems(p: Product): Problem[] {
  const out: Problem[] = [];
  const facts: Facts = { hypoallergenic: p.hypoallergenic, nickel_free: p.nickel_free };
  for (const [label, text] of publishedText(p)) {
    for (const m of scanText(text, facts)) out.push({ level: "block", message: `${label} contains ${m}.` });
    if (DEMO_MARK.test(text)) {
      out.push({ level: "block", message: `${label} is demo placeholder text. Run the real analysis or rewrite it.` });
    }
  }
  strings(p.hashtags).forEach((tag, i) => {
    for (const m of scanHashtag(tag, facts)) out.push({ level: "block", message: `Hashtag ${i + 1} (${tag}) contains ${m}.` });
  });
  return out;
}

export const READY_STATES = ["ready", "scheduled", "posted"];

/** True for a usable price: a finite number above zero. Strings, NaN and Infinity fail. */
const hasPrice = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;

const PLATING_OK = /\b10\s?k(?:t|arat)?[\s-]+gold[\s-]*plated\b|\b10\s?k\s?gp\b/i;

/** `approvedImageCount` is the number of approved photos (originals count; unapproved AI pictures do not). */
export function checkProduct(p: Product, approvedImageCount: number): Problem[] {
  const out: Problem[] = [];
  const block = (message: string) => out.push({ level: "block", message });
  const warn = (message: string) => out.push({ level: "warn", message });

  out.push(...claimProblems(p));
  const seenWarn = new Set<string>();
  for (const [label, text] of publishedText(p)) {
    for (const m of scanWarnings(text)) {
      if (!seenWarn.has(label + m)) {
        seenWarn.add(label + m);
        warn(`${label} contains ${m}.`);
      }
    }
  }

  if (!String(p.name ?? "").trim()) block("Add a product name.");
  if (approvedImageCount === 0) block("Add at least one approved photo.");
  if (!hasPrice(p.price_cad)) block("Set a price.");
  // Gold pieces must say "10K gold-plated". A silver-coloured piece may say how it is plated ("rhodium-plated"), and a genuine
  // branded piece is whatever it really is, so the owner's own wording is not forced.
  const plating = normaliseText(String(p.plating ?? ""));
  const platedWord = /(?<!\bnot\s)\bplated\b/i.test(plating);
  if (p.authenticity !== "genuine") {
    if (/gold/i.test(plating)) {
      if (!PLATING_OK.test(plating)) block("Plating should read “10K gold-plated”.");
    } else if (!platedWord) {
      block("Say how it is plated, for example “10K gold-plated” (gold colour) or “rhodium-plated” (silver colour).");
    }
  }
  if (/gold/i.test(plating) && /silver|white|rhodium|platinum|steel/i.test(String(p.colour_finish ?? ""))) {
    warn("The plating says gold but the colour or finish says silver or white. Check which is right.");
  }

  // Another brand's name or logo on the piece: photos and marks are never altered, but the owner must say what it is
  // before it can be posted. Marks are recorded exactly as seen (by the AI or by the owner).
  const marks = (p.marks_seen ?? []).filter(Boolean);
  if (marks.length) {
    const shown = marks.slice(0, 3).join(", ");
    if (!p.authenticity) {
      block(`This piece shows another brand's mark (${shown}). Say whether it is genuine under “Brand marks” before it can be posted.`);
    } else if (p.authenticity === "not_genuine") {
      block(`This piece carries another brand's mark (${shown}) and is not genuine, so it cannot be posted. Keep it for your records.`);
    } else {
      warn("Genuine brand piece: keep the receipt or certificate, and describe the metal and plating exactly as they are.");
    }
  }

  if (!p.analysed_at) warn("Run the AI analysis to get descriptions and captions.");
  if (strings(p.captions).length === 0) warn("No captions yet.");
  if (!String(p.base_metal ?? "").trim()) warn("Base metal is empty (the bot will hand material questions to you).");
  if (!String(p.sizes ?? "").trim()) warn("Sizes / lengths are empty.");
  if (p.nickel_free == null) warn("Nickel-free status is unknown (the bot will say it is checking).");
  if (p.stock_qty === 0 && p.status !== "sold_out") warn("Stock is 0.");
  if (p.cost_cad == null) warn("Add your cost to see margin.");
  return out;
}
