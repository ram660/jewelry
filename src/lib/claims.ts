import type { Product } from "./types";

/** Pure functions, safe to run in the browser and on the server. */

export interface Problem {
  level: "block" | "warn";
  message: string;
}

/** Facts from the product record that make some otherwise-banned claims allowed. */
export interface ClaimContext {
  nickelFree?: boolean | null;
  hypoallergenic?: boolean | null;
  antiTarnish?: boolean | null;
}

interface Rule {
  re: RegExp;
  msg: string;
  /** The claim is fine only when the owner has confirmed the fact on the product. */
  allowIf?: (c: ClaimContext) => boolean;
}

// Wording that misdescribes 10K gold-plated jewellery (see docs/BRAND.md and KNOWLEDGE_BASE.md). Patterns avoid a
// trailing \b where hashtags glue words together (#14kgold, #solidgold, #waterproofjewelry).
const NOT_PLATED = String.raw`(?![\s-]*(?:plated|tone))`;
const KARAT = String.raw`(?:k|kt|ct|karats?|carats?)`;
const RULES: Rule[] = [
  {
    re: new RegExp(String.raw`(?:solid|real|genuine|pure|authentic|fine|precious|luxury|\d+\s?(?:%|percent|per\s+cent))[\s-]*gold${NOT_PLATED}|(?:solid|pure|real|genuine|100\s?%)[\s-]*gold[\s-]*plated|\b(?:genuine|real|authentic|pure|solid)[\s-]+10[\s-]?${KARAT}`, "i"),
    msg: "a “solid gold” / “real gold” claim: the pieces are 10K gold-plated",
  },
  {
    re: new RegExp(String.raw`\b(?:10[\s-]?${KARAT}|ten[\s-]+(?:karats?|carats?))[\s-]*(?:yellow|white|rose|solid|real|pure)?[\s-]*gold${NOT_PLATED}`, "i"),
    msg: "“10K gold” without “plated”: say “10K gold-plated”",
  },
  {
    re: new RegExp(String.raw`(?<!\d)(?:9|12|14|18|22|24)[\s-]?${KARAT}(?=$|[^a-z]|gold)|\b(?:nine|twelve|fourteen|eighteen|twenty[\s-]?two|twenty[\s-]?four)[\s-]+(?:karats?|carats?)`, "i"),
    msg: "a karat other than 10K",
  },
  {
    re: /(?:water|splash|sweat|rain)[\s-]?(?:proof|resistant|safe|friendly|repellent)|(?:shower|swim|pool)[\s-]?(?:safe|proof|friendly|ready)|\bwear\s+(?:it\s+)?(?:in|while)\s+(?:the\s+)?(?:shower|swimming|pool)/i,
    msg: "“waterproof” / water-resistant: plated jewellery should avoid water",
  },
  {
    re: /tarnish[\s-]?(?:free|proof)|non[\s-]?tarnish|\bno[\s-]+(?:tarnish|fading)|(?:fade|rust|corrosion|chip|peel|scratch|discolou?r(?:ation)?)[\s-]?(?:resistant|proof|free)|\b(?:never|won'?t|will\s+not|doesn'?t|does\s+not)\s+(?:fade|tarnish|rust|peel|chip|scratch|discolou?r)|indestructible/i,
    msg: "a tarnish-free / will-not-fade claim",
  },
  {
    re: /tarnish[\s-]?resistant|anti[\s-]?tarnish/i,
    msg: "“anti-tarnish”: only when the product is confirmed anti-tarnish",
    allowIf: (c) => c.antiTarnish === true,
  },
  {
    re: /for\s?ever(?!y)|everlasting|\bpermanent|life[\s-]?long|life[\s-]?time|\blasts?\s+(?:for\s+)?(?:years|decades|life)|guarantee/i,
    msg: "a lasts-forever / lifetime / guarantee claim",
  },
  {
    re: /hypo[\s-]?aller\w*/i,
    msg: "“hypoallergenic”: only claim it with a supplier certificate (tick it on the product)",
    allowIf: (c) => c.hypoallergenic === true,
  },
  {
    re: /(?:nickel|lead)[\s-]?free|\bno\s+(?:nickel|lead)\b|skin[\s-]?(?:safe|friendly)|(?:safe|gentle|friendly|good|great|suitable|ideal)\s+(?:for|on)\s+(?:sensitive\s+)?skin|allerg\w*[\s-]?(?:safe|free)|irritation[\s-]?free|(?:never|won'?t|will\s+not|doesn'?t|does\s+not)\s+turn\s+(?:\w+\s+){0,3}green|\bno\s+(?:green\s+(?:skin|marks?|fingers?)|skin\s+discolou?ration)/i,
    msg: "a nickel-free / skin-safe claim: only when the product is confirmed nickel-free",
    allowIf: (c) => c.nickelFree === true,
  },
  {
    re: /gold[\s-]?fill|vermeil|premium(?:\s+quality)?\s+gold|high[\s-]?quality\s+gold(?![\s-]*(?:plated|tone))/i,
    msg: "“gold-filled” / “vermeil” / “premium gold”: the pieces are 10K gold-plated",
  },
];

// An honest negation such as "It is not solid gold" or "not waterproof" (approved answers in KNOWLEDGE_BASE.md) is fine.
const NEGATED = /\b(?:not|isn'?t|aren'?t|no|never|nor|than|unlike)\s+(?:a\s+|an\s+|made\s+of\s+|recommended\s+as\s+)?$/i;

/** Phone keyboards and AI output use curly apostrophes, odd dashes and invisible characters: fold them first. */
const normalise = (s: string) =>
  s.normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u00A0\u202F]/g, " ");

export function scanText(raw: string, ctx: ClaimContext = {}): string[] {
  if (!raw) return [];
  const text = normalise(raw);
  return RULES.filter((r) => {
    if (r.allowIf && r.allowIf(ctx)) return false;
    for (const m of text.matchAll(new RegExp(r.re.source, r.re.flags + "g"))) {
      if (!NEGATED.test(text.slice(Math.max(0, m.index - 30), m.index))) return true;
    }
    return false;
  }).map((r) => r.msg);
}
export const claimContext = (p: Pick<Product, "nickel_free" | "hypoallergenic" | "anti_tarnish">): ClaimContext => ({
  nickelFree: p.nickel_free, hypoallergenic: p.hypoallergenic, antiTarnish: p.anti_tarnish,
});

const TEXT_FIELDS: [keyof Product, string][] = [
  ["name", "Name"],
  ["short_desc", "Short description"],
  ["long_desc", "Full description"],
  ["care_notes", "Care notes"],
  ["alt_text", "Alt text"],
  ["plating", "Plating"],
];

export const READY_STATES = ["ready", "scheduled", "posted"];

export function checkProduct(p: Product, imageCount: number): Problem[] {
  const out: Problem[] = [];
  const block = (message: string) => out.push({ level: "block", message });
  const warn = (message: string) => out.push({ level: "warn", message });
  const ctx = claimContext(p);

  for (const [field, label] of TEXT_FIELDS) {
    for (const m of scanText(String(p[field] ?? ""), ctx)) block(`${label} contains ${m}.`);
  }
  p.captions.forEach((c, i) => {
    for (const m of scanText(c, ctx)) block(`Caption ${i + 1} contains ${m}.`);
  });
  // Hashtags are public too.
  for (const m of scanText(p.hashtags.join(" "), ctx)) block(`Hashtags contain ${m}.`);

  if (!p.name.trim()) block("Add a product name.");
  if (imageCount === 0) block("Add at least one photo.");
  if (p.price_cad == null || p.price_cad <= 0) block("Set a price.");
  if (!/10\s?k/i.test(p.plating) || !/plated/i.test(p.plating)) block("Plating should read “10K gold-plated”.");

  if (!p.analysed_at) warn("Run the AI analysis to get descriptions and captions.");
  if (p.captions.length === 0) warn("No captions yet.");
  if (!p.base_metal.trim()) warn("Base metal is empty (the bot will hand material questions to you).");
  if (!p.sizes.trim()) warn("Sizes / lengths are empty.");
  if (p.nickel_free == null) warn("Nickel-free status is unknown (the bot will say it is checking).");
  if (p.stock_qty === 0 && p.status !== "sold_out") warn("Stock is 0.");
  if (p.cost_cad == null) warn("Add your cost to see margin.");
  return out;
}
