import { z } from "zod";
import { AUTHENTICITY, CATEGORIES, GENDERS, STATUSES } from "./types.ts";

/**
 * What PATCH /api/products/[id] accepts. Forms send numbers as text, so "12.50" is fine, "" or null clears the
 * field, and anything that is not a number ("abc") is refused instead of silently becoming empty.
 * Unknown keys (id, sku, timestamps sent back by the editor) are dropped. Over-long text and lists are trimmed rather
 * than refused: the editor sends every field on Save, so one long AI-written caption must not block saving forever.
 */
const money = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : typeof v === "string" ? Number(v.trim()) : v),
    z.number({ error: `${label} must be a number.` }).finite().min(0, `${label} cannot be negative.`).max(100000).nullable()
  );

const count = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v),
    z.number({ error: `${label} must be a whole number.` }).int(`${label} must be a whole number.`).min(0).max(1000000)
  );

const text = (max = 2000) => z.string({ error: "Text fields must be text." }).transform((s) => s.slice(0, max));
const list = (max = 300) => z.array(text(max), { error: "Lists must be lists of text." }).transform((a) => a.slice(0, 60));
const flag = z.boolean({ error: "Yes/no fields must be true, false or null." }).nullable();

export const ProductPatch = z.object({
  name: text(120),
  category: z.enum(CATEGORIES, { error: "Unknown category." }),
  subcategory: text(80),
  gender: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.union([z.enum(GENDERS), z.literal("")], { error: "Gender must be women, men or unisex." })
  ),
  plating: text(80),
  base_metal: text(80),
  plating_microns: text(40),
  nickel_free: flag,
  hypoallergenic: flag,
  anti_tarnish: flag,
  colour_finish: text(80),
  stones: text(200),
  sizes: text(200),
  weight_g: money("Weight"),
  price_cad: money("Price"),
  cost_cad: money("Cost"),
  compare_at_cad: money("Compare-at price"),
  stock_qty: count("Stock"),
  low_stock_at: count("Low-stock level"),
  status: z.enum(STATUSES, { error: "Unknown status." }),
  style_tags: list(60),
  occasion_tags: list(60),
  name_suggestions: list(120),
  short_desc: text(500),
  long_desc: text(4000),
  care_notes: text(1000),
  captions: list(2200),
  hashtags: list(60),
  alt_text: text(500),
  owner_questions: list(300),
  marks_seen: list(160),
  authenticity: z.enum(AUTHENTICITY, { error: "Authenticity must be empty, genuine or not_genuine." }),
  mark_analysed: z.boolean().optional(),
}).partial();

export type ProductPatchInput = z.infer<typeof ProductPatch>;
