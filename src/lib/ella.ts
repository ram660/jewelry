import { normaliseText, scanText, type Facts } from "./claims.ts";
import type { Product } from "./types.ts";

/**
 * Ella, the reply writer. Pure functions: no database, no network, no AI.
 *
 * It reads a customer message, decides what they are asking, and writes a DRAFT from the approved answers in
 * docs/KNOWLEDGE_BASE.md and the product record. It never invents a fact. Anything that is an owner decision
 * (shipping, returns, discounts, orders, custom work, complaints, skin reactions) or a [CONFIRM] item gets a short
 * holding reply and is flagged for the owner. Every draft is also run through the banned-claims scanner.
 */

export type Intent =
  | "price" | "size" | "material" | "water" | "tarnish" | "skin" | "green" | "care" | "stock"
  | "shipping" | "order" | "discount" | "custom" | "returns"
  | "complaint" | "person" | "identity" | "greeting" | "praise" | "unknown";

export type EventKind = "dm" | "comment" | "story_reply" | "story_mention" | "postback";
export type Channel = "dm" | "comment_public" | "comment_private";

const RULES: [Intent, RegExp][] = [
  // Things that always need the owner. Checked first.
  ["complaint", /\b(refund|money back|damaged|broken|broke|wrong (?:item|order|size|piece)|missing|never (?:arrived|received|came)|where(?:'s| is) my order|scam|terrible|disappointed|angry|rash|itch\w*|swollen|swelling|burn(?:s|ed|ing)?|infect\w*|reaction|irritated|not happy|unhappy)\b/i],
  ["person", /\b(talk|speak|chat) (?:to|with) (?:a |the )?(?:person|human|owner|someone|manager)\b|\breal (?:person|human)\b|\bhuman\b/i],
  ["identity", /\bare you (?:a |an )?(?:bot|robot|ai|real|human|person)\b|\bis this (?:a )?(?:bot|robot|ai)\b/i],
  ["order", /\bi(?:'ll| will) take (?:it|this|that|one)\b|\bi want (?:it|this|that|to buy|to order)\b|\bwant to (?:buy|order)\b|\bhow (?:do|can) i (?:buy|order|pay)\b|\bplace an order\b|\bbuy (?:it|this)\b|\border (?:it|this)\b|\breserve\b|\bhold (?:it|this)\b|\bpayment\b|\be-?transfer\b|\binterac\b|\bhow to pay\b/i],
  ["discount", /\bdiscount|coupon|promo\b|\bcheaper|lower price|best price|any deals?|\bsale\b/i],
  ["custom", /\bcustom\b|\bengrav\w*|\bpersonali[sz]\w*|\bmonogram\b|\bbulk\b|\bwholesale\b|\bcollab\w*|\binfluencer\b|\bgift ?(?:box|wrap\w*)\b|\bpackag\w*/i],
  ["returns", /\breturns?\b|\bexchange\b|\bwarranty\b|\bguarantee\b/i],
  ["shipping", /\bship\w*|\bdeliver\w*|\bpostage\b|\bpick ?up\b|\bcourier\b|\btracking\b|\bcanada post\b|\binternational\b|\barriv\w*|\bhow long (?:does|will) (?:it|shipping|delivery)\s+take\b/i],
  // Things we can answer from the knowledge base and the product record.
  ["price", /\b(?:price|prices|pricing|how much|costs?)\b|\$\s?\d|\bcad\b/i],
  ["size", /\b(?:sizes?|sizing|length|how long is|how big|fits?|adjustable|wrist size|finger size|ring size|inch(?:es)?|mm|cm)\b/i],
  ["material", /\b(?:real|genuine|solid|pure) gold\b|\bis (?:it|this) (?:real|gold|solid)\b|\bplated|\bplating\b|\bmaterial\b|\bmade (?:of|from)\b|\bwhat metal\b|\bbase metal\b|\bbrass\b|\bcopper\b|\bstainless\b|\bsterling\b|\bkarat\b|\b10\s?k\b/i],
  ["water", /\bwater\w*|\bshower\w*|\bswim\w*|\bpool\b|\bocean\b|\bsweat\w*|\bgym\b|\bworkout\w*|\bhot tub\b|\bsauna\b|\bget wet\b|\brain\b/i],
  ["tarnish", /\btarnish\w*|\bfad(?:e|es|ing)\b|\bdiscolou?r\w*|\bdurab\w*|\bhow long will (?:it|this) (?:last|stay|keep)\b|\bwear off\b|\bpeel\w*|\bchip\w*|\blast(?:s)? long\b|\blast(?:s)? forever\b/i],
  ["green", /\bgreen\b|\bstain\w*/i],
  ["skin", /\bsensitive skin\b|\ballerg\w*|\bhypo\w*|\bnickel\b|\blead\b|\bskin[- ]?safe\b|\beczema\b/i],
  ["care", /\bcare\b|\bclean\w*|\bpolish\w*|\bstor(?:e|age)\b|\bmaintain\w*|\blook after\b/i],
  ["stock", /\bin stock\b|\bavailable\b|\bavailability\b|\bstill have\b|\bsold out\b|\brestock\w*|\bdo you have\b|\blast one\b|\bhow many\b/i],
  ["greeting", /^\s*(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening))\b[\s!.,]*$/i],
  ["praise", /\b(?:love|beautiful|gorgeous|stunning|pretty|lovely|obsessed|cute|elegant)\b|😍|❤️|🔥|💛|🤍/i],
];

/** Every intent found in the message, in rule order. "unknown" only when nothing matched. */
export function classify(text: string): Intent[] {
  const t = normaliseText(String(text ?? "")).trim();
  if (!t) return ["unknown"];
  // A lone sparkle on a post is the "comment ✨ for details" call to action.
  if (/^[✨\s]+$/.test(t)) return ["price"];
  let found = RULES.filter(([, re]) => re.test(t)).map(([i]) => i);
  // "How much is shipping?" is a delivery question, not a price question. A real price word keeps it.
  const aboutShipping = /\b(?:how much|costs?)\b[^.?!,]{0,25}\b(?:ship\w*|deliver\w*|postage)\b|\b(?:ship\w*|deliver\w*|postage)\b[^.?!,]{0,15}\b(?:costs?|fees?)\b/i;
  if (found.includes("shipping") && found.includes("price") && aboutShipping.test(t) && !/\bprices?\b|\bpricing\b|\$\s?\d|\bcad\b/i.test(t)) {
    found = found.filter((i) => i !== "price");
  }
  // "Are you a real person?" asks about her. It is not a request to talk to someone.
  if (found.includes("identity")) found = found.filter((i) => i !== "person");
  return found.length ? found : ["unknown"];
}

const OWNER_INTENTS: Intent[] = ["complaint", "person", "order", "discount", "custom", "returns", "shipping"];

export interface ProductRef { id: number; name: string; sku: string }

/** Finds the product a message is about from an SKU or a product name. Null when none or when it is ambiguous. */
export function findProduct(text: string, products: ProductRef[]): number | null {
  const t = normaliseText(String(text ?? "")).toLowerCase();
  const sku = t.match(/efj-[a-z]{2}-\d{4}/);
  if (sku) {
    const hit = products.find((p) => p.sku.toLowerCase() === sku[0]);
    if (hit) return hit.id;
  }
  const named = products.filter((p) => p.name.trim().length >= 3 && t.includes(p.name.trim().toLowerCase()));
  if (named.length === 0) return null;
  const longest = Math.max(...named.map((p) => p.name.trim().length));
  const best = named.filter((p) => p.name.trim().length === longest);
  return best.length === 1 ? best[0].id : null;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)} CAD`;

const HOLD = "I'm passing this to our owner so they can help you personally. They'll reply as soon as they can.";
const SORRY = "I'm so sorry about that. I'm passing this to our owner right now so they can sort it out personally. They'll reply as soon as they can.";
const ASK_PIECE = "Which piece are you asking about? Send me its name or a photo and I'll check for you.";

export interface DraftItem { channel: Channel; text: string }
export interface DraftResult {
  intents: Intent[];
  drafts: DraftItem[];
  needsOwner: boolean;
  reason: string;
}

type P = Pick<Product, "name" | "price_cad" | "sizes" | "base_metal" | "nickel_free" | "hypoallergenic" | "stock_qty" | "low_stock_at" | "status">;

/** One answer sentence for an intent, or a note that the owner must answer. */
function answer(intent: Intent, p: P | null): { text?: string; owner?: string } {
  const name = p?.name?.trim() || "piece";
  switch (intent) {
    case "price":
      if (!p) return { text: ASK_PIECE };
      return p.price_cad != null && p.price_cad > 0
        ? { text: `The ${name} is ${money(p.price_cad)}, 10K gold-plated.` }
        : { owner: "price not set for this product" };
    case "size":
      if (!p) return { text: ASK_PIECE };
      return p.sizes.trim() ? { text: `Sizes and lengths: ${p.sizes.trim()}.` } : { owner: "sizes not set for this product" };
    case "material": {
      const base = p?.base_metal?.trim();
      return { text: `It's 10K gold-plated${base ? ` over ${base}` : ""}. That's a thin layer of gold, not solid gold. It's priced as fashion jewellery. You get the warm gold look for everyday wear.` };
    }
    case "water":
      return { text: "We recommend taking it off before showering, swimming, hot tubs, saunas and workouts. Water, chlorine, salt and sweat wear plating faster." };
    case "tarnish":
      return { text: "All plated jewellery wears over time. How fast depends on how often you wear it and what it touches. Good care helps slow wear." };
    case "green":
      return { text: "Some base metals can react with skin, sweat or lotion. Once the plating wears, they can leave a temporary mark. It usually washes off with soap and water. If you notice redness or irritation, stop wearing it and let me know." };
    case "skin": {
      const bits: string[] = [];
      if (p?.nickel_free === true) bits.push("Our records say this piece is nickel-free.");
      if (p?.hypoallergenic === true) bits.push("It is listed as hypoallergenic.");
      if (bits.length) return { text: bits.join(" ") };
      return { owner: "skin and allergy facts are not confirmed for this product" };
    }
    case "care":
      return { text: "Put it on last, after lotion and perfume. Take it off first, before showering, swimming, the gym and sleep. Wipe it with a soft dry cloth. Store each piece separately in its pouch or an airtight bag." };
    case "stock":
      if (!p) return { text: ASK_PIECE };
      if (p.status === "sold_out" || p.stock_qty <= 0) return { owner: "this product shows as sold out; the customer may want a restock" };
      return { text: `Yes, the ${name} is available.${p.stock_qty <= p.low_stock_at ? ` Only ${p.stock_qty} left.` : ""}` };
    case "identity":
      return { text: "I'm Ella, the shop's virtual assistant. 💛 I can help with sizes, care and questions about our pieces, and I'll bring in our owner whenever you like." };
    case "greeting":
      return { text: "Hi! 💛 I'm Ella from Elegant Fashion Jewellery. Which piece are you interested in?" };
    case "praise":
      return { text: "Thank you so much! 💛" };
    default:
      return {};
  }
}

/**
 * Writes the draft reply (or replies) for one customer message.
 * `kind` decides the channel: comments get a short public reply plus the real answer by private message.
 */
export function draftReplies(input: { text: string; kind: EventKind; product: P | null }): DraftResult {
  const { kind, product } = input;
  const intents = classify(input.text);
  const isComment = kind === "comment";
  const facts: Facts = { hypoallergenic: product?.hypoallergenic, nickel_free: product?.nickel_free };

  const finish = (text: string, needsOwner: boolean, reason: string): DraftResult => {
    // Last line of defence: no draft leaves this function with wording we do not allow.
    const problems = scanText(text, facts);
    if (problems.length) {
      return finishHold(`the draft contained wording we do not allow (${problems[0]})`);
    }
    return { intents, drafts: toDrafts(text, needsOwner), needsOwner, reason };
  };
  const toDrafts = (text: string, owner: boolean): DraftItem[] => {
    if (!isComment) return [{ channel: "dm", text }];
    // A complaint or health worry on a public comment gets no public reply, only a private one for the owner to send.
    const publicReply = owner ? [] : [{ channel: "comment_public" as const, text: "Sent you a DM 💛" }];
    return [...publicReply, { channel: "comment_private", text }];
  };
  const finishHold = (reason: string): DraftResult => ({ intents, drafts: toDrafts(HOLD, true), needsOwner: true, reason });

  if (intents.includes("complaint")) return finish(SORRY, true, "complaint, refund or possible skin reaction");
  // A request to talk to someone goes straight to the owner. ("Are you a real person?" is classed as identity, not this.)
  if (intents.includes("person")) return finish(HOLD, true, "the customer asked for a person");

  // A public comment we cannot read the intent of is flagged for the owner without sending a generic reply.
  if (isComment && intents.length === 1 && intents[0] === "unknown") {
    return { intents, drafts: [], needsOwner: true, reason: "could not tell what the commenter is asking" };
  }

  // Pure praise on a post gets a public thank-you and nothing else.
  if (intents.length === 1 && intents[0] === "praise" && isComment) {
    return { intents, drafts: [{ channel: "comment_public", text: "Thank you so much! 💛" }], needsOwner: false, reason: "" };
  }

  const parts: string[] = [];
  const ownerReasons: string[] = [];
  for (const i of intents) {
    if (OWNER_INTENTS.includes(i)) {
      ownerReasons.push(
        i === "shipping" ? "shipping and delivery are not confirmed yet"
        : i === "returns" ? "returns and warranty terms are not confirmed yet"
        : i === "order" ? "the customer wants to order or pay"
        : i === "discount" ? "the customer asked about a discount"
        : "custom or gift-packaging request"
      );
      continue;
    }
    if (i === "unknown") { ownerReasons.push("could not tell what the customer is asking"); continue; }
    const a = answer(i, product);
    if (a.text) parts.push(a.text);
    if (a.owner) ownerReasons.push(a.owner);
  }

  // "Which piece?" is only useful once.
  const dedup = parts.filter((t, idx) => parts.indexOf(t) === idx);
  const needsOwner = ownerReasons.length > 0;
  if (needsOwner) {
    // "The rest" only makes sense when something was answered first.
    dedup.push(dedup.length ? "I'm checking the rest with our owner. We'll get back to you as soon as we can." : "I don't want to guess on this one. Let me check with our owner and get back to you.");
  }
  if (dedup.length === 0) return finishHold("nothing to answer");
  return finish(dedup.join(" "), needsOwner, ownerReasons.join("; "));
}
