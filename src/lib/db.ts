import path from "node:path";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Product, ProductImage } from "./types";

/**
 * Where the database and uploaded photos live. This is the owner's real catalog: back it up, never wipe it.
 * Automated tests set EFJ_DATA_DIR to a throw-away folder so they can never touch it.
 */
export const DATA_DIR = process.env.EFJ_DATA_DIR || path.join(process.cwd(), "data");

const globalForDb = globalThis as unknown as { __efjDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (globalForDb.__efjDb) return globalForDb.__efjDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // getBuiltinModule is a runtime call, so webpack doesn't try to bundle node:sqlite.
  const sqlite = process.getBuiltinModule("node:sqlite");
  if (!sqlite) throw new Error("This app needs Node 22.13 or newer (node:sqlite).");
  const Db = sqlite.DatabaseSync;
  const d = new Db(path.join(DATA_DIR, "efj.db"));
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      subcategory TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'women',
      plating TEXT NOT NULL DEFAULT '10K gold-plated',
      base_metal TEXT NOT NULL DEFAULT '',
      plating_microns TEXT NOT NULL DEFAULT '',
      nickel_free INTEGER,
      colour_finish TEXT NOT NULL DEFAULT '',
      stones TEXT NOT NULL DEFAULT '',
      sizes TEXT NOT NULL DEFAULT '',
      weight_g REAL,
      price_cad REAL,
      cost_cad REAL,
      compare_at_cad REAL,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      low_stock_at INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'draft',
      hypoallergenic INTEGER,
      anti_tarnish INTEGER,
      style_tags TEXT NOT NULL DEFAULT '[]',
      occasion_tags TEXT NOT NULL DEFAULT '[]',
      name_suggestions TEXT NOT NULL DEFAULT '[]',
      short_desc TEXT NOT NULL DEFAULT '',
      long_desc TEXT NOT NULL DEFAULT '',
      care_notes TEXT NOT NULL DEFAULT '',
      captions TEXT NOT NULL DEFAULT '[]',
      hashtags TEXT NOT NULL DEFAULT '[]',
      alt_text TEXT NOT NULL DEFAULT '',
      owner_questions TEXT NOT NULL DEFAULT '[]',
      analysed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'original',
      path TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  migrate(d);
  globalForDb.__efjDb = d;
  return d;
}

/** Adds columns introduced after the first release. Safe to run on every start. */
function migrate(d: DatabaseSync) {
  // product_images columns
  const imgCols = new Set(
    (d.prepare("PRAGMA table_info(product_images)").all() as Row[]).map((c) => String(c.name))
  );
  const addImg = (name: string, ddl: string) => {
    if (!imgCols.has(name)) d.exec(`ALTER TABLE product_images ADD COLUMN ${name} ${ddl}`);
  };
  addImg("label", "TEXT");
  addImg("prompt_used", "TEXT");
  addImg("model_used", "TEXT");
  addImg("fidelity_score", "INTEGER");
  addImg("fidelity_notes", "TEXT");
  addImg("source_image_id", "INTEGER");
  addImg("carousel_pos", "INTEGER");
  // SHA-256 of the file as uploaded, to notice the same photo being added twice.
  addImg("sha256", "TEXT");
  d.exec("CREATE INDEX IF NOT EXISTS product_images_sha ON product_images(sha256)");

  // products columns added after initial release
  const prodCols = new Set(
    (d.prepare("PRAGMA table_info(products)").all() as Row[]).map((c) => String(c.name))
  );
  const addProd = (name: string, ddl: string) => {
    if (!prodCols.has(name)) d.exec(`ALTER TABLE products ADD COLUMN ${name} ${ddl}`);
  };
  addProd("compare_at_cad", "REAL");
  addProd("low_stock_at", "INTEGER NOT NULL DEFAULT 3");
  addProd("hypoallergenic", "INTEGER");
  addProd("anti_tarnish", "INTEGER");
  addProd("name_suggestions", "TEXT NOT NULL DEFAULT '[]'");
  // Brand names, logos and engraved text visible on the piece, copied exactly as photographed, and whether the owner
  // says the piece is genuine. Empty means nobody has answered yet.
  addProd("marks_seen", "TEXT NOT NULL DEFAULT '[]'");
  addProd("authenticity", "TEXT NOT NULL DEFAULT ''");
}

const JSON_FIELDS = ["style_tags", "occasion_tags", "captions", "hashtags", "owner_questions", "name_suggestions", "marks_seen"] as const;

// Fields the editor may change. Everything else (id, sku, timestamps) is server-controlled.
const EDITABLE = [
  "name", "category", "subcategory", "gender", "plating", "base_metal", "plating_microns",
  "nickel_free", "hypoallergenic", "anti_tarnish", "colour_finish", "stones", "sizes",
  "weight_g", "price_cad", "cost_cad", "compare_at_cad", "low_stock_at",
  "stock_qty", "status", "style_tags", "occasion_tags", "name_suggestions", "short_desc", "long_desc",
  "care_notes", "captions", "hashtags", "alt_text", "owner_questions", "marks_seen", "authenticity",
] as const;

type Row = Record<string, unknown>;

function rowToProduct(r: Row): Product {
  const out: Row = { ...r };
  for (const f of JSON_FIELDS) {
    try {
      out[f] = JSON.parse(String(r[f] ?? "[]"));
    } catch {
      out[f] = [];
    }
  }
  out.nickel_free = r.nickel_free == null ? null : Number(r.nickel_free) === 1;
  out.hypoallergenic = r.hypoallergenic == null ? null : Number(r.hypoallergenic) === 1;
  out.anti_tarnish = r.anti_tarnish == null ? null : Number(r.anti_tarnish) === 1;
  out.low_stock_at = r.low_stock_at == null ? 3 : Number(r.low_stock_at);
  return out as unknown as Product;
}

function rowToImage(r: Row): ProductImage {
  return {
    id: Number(r.id),
    product_id: Number(r.product_id),
    kind: String(r.kind) as ProductImage["kind"],
    path: String(r.path),
    thumb_path: String(r.thumb_path),
    sort_order: Number(r.sort_order),
    approved: Number(r.approved) === 1,
    label: (r.label as string | null) ?? null,
    prompt_used: (r.prompt_used as string | null) ?? null,
    model_used: (r.model_used as string | null) ?? null,
    fidelity_score: r.fidelity_score == null ? null : Number(r.fidelity_score),
    fidelity_notes: (r.fidelity_notes as string | null) ?? null,
    source_image_id: r.source_image_id == null ? null : Number(r.source_image_id),
    carousel_pos: r.carousel_pos == null ? null : Number(r.carousel_pos),
  };
}

const SKU_CODE: Record<string, string> = {
  ring: "RG", bracelet: "BR", chain: "CH", necklace: "NK",
  earring: "ER", anklet: "AN", set: "ST", other: "OT",
};

export function listProducts(): Product[] {
  const rows = db().prepare("SELECT * FROM products ORDER BY id DESC").all() as Row[];
  return rows.map(rowToProduct);
}

export function getProduct(id: number): Product | null {
  const r = db().prepare("SELECT * FROM products WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToProduct(r) : null;
}

export function createProduct(name: string, category = "other"): Product {
  const d = db();
  const res = d.prepare("INSERT INTO products (name, category) VALUES (?, ?)").run(name, category);
  const id = Number(res.lastInsertRowid);
  setSku(id, category);
  return getProduct(id)!;
}

function setSku(id: number, category: string) {
  const code = SKU_CODE[category] ?? "OT";
  db()
    .prepare("UPDATE products SET sku = ? WHERE id = ?")
    .run(`EFJ-${code}-${String(id).padStart(4, "0")}`, id);
}

export function updateProduct(id: number, patch: Record<string, unknown>): Product | null {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const BOOL_FIELDS = ["nickel_free", "hypoallergenic", "anti_tarnish"];
  const NULLABLE_NUMERIC = ["weight_g", "price_cad", "cost_cad", "compare_at_cad"];
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if ((JSON_FIELDS as readonly string[]).includes(k)) v = JSON.stringify(v ?? []);
    else if (BOOL_FIELDS.includes(k)) v = v == null ? null : v ? 1 : 0;
    else if (NULLABLE_NUMERIC.includes(k)) {
      v = v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v);
    } else if (k === "stock_qty") v = Math.max(0, Math.trunc(Number(v) || 0));
    else if (k === "low_stock_at") v = Math.max(0, Math.trunc(Number(v) || 3));
    sets.push(`${k} = ?`);
    vals.push(v as string | number | null);
  }
  if (sets.length) {
    db()
      .prepare(`UPDATE products SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .run(...vals, id);
    if ("category" in patch) setSku(id, String(patch.category));
  }
  return getProduct(id);
}

export function markAnalysed(id: number) {
  db().prepare("UPDATE products SET analysed_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteProduct(id: number) {
  db().prepare("DELETE FROM products WHERE id = ?").run(id);
}

export function listImages(productId: number): ProductImage[] {
  const rows = db()
    .prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id")
    .all(productId) as Row[];
  return rows.map(rowToImage);
}

/** The primary (first) original photo of every product, used as the catalog thumbnail. */
export function firstImages(): Map<number, ProductImage> {
  const rows = db()
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY sort_order, id) AS rn
         FROM product_images WHERE kind = 'original'
       ) WHERE rn = 1`
    )
    .all() as Row[];
  return new Map(rows.map((r) => [Number(r.product_id), rowToImage(r)]));
}

export interface NewImage {
  kind?: string;
  approved?: boolean;
  label?: string;
  prompt_used?: string;
  model_used?: string;
  fidelity_score?: number | null;
  fidelity_notes?: string | null;
  source_image_id?: number | null;
  /** SHA-256 (hex) of the uploaded file. Only set for original photos. */
  sha256?: string | null;
}

export function nextSortOrder(productId: number): number {
  const r = db()
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_images WHERE product_id = ?")
    .get(productId) as Row;
  return Number(r.n);
}

export function addImage(productId: number, p: string, thumb: string, order: number, o: NewImage = {}): number {
  const res = db()
    .prepare(
      `INSERT INTO product_images
         (product_id, kind, path, thumb_path, sort_order, approved, label, prompt_used, model_used,
          fidelity_score, fidelity_notes, source_image_id, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      productId, o.kind ?? "original", p, thumb, order, o.approved === false ? 0 : 1,
      o.label ?? null, o.prompt_used ?? null, o.model_used ?? null,
      o.fidelity_score ?? null, o.fidelity_notes ?? null, o.source_image_id ?? null, o.sha256 ?? null
    );
  return Number(res.lastInsertRowid);
}

export interface DuplicateHit {
  sha256: string;
  image_id: number;
  product_id: number;
  product_name: string;
  sku: string;
}

/** Original photos already in the catalog whose bytes match one of these hashes. */
export function findOriginalsByHash(hashes: string[]): DuplicateHit[] {
  if (!hashes.length) return [];
  const marks = hashes.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT i.sha256, i.id AS image_id, i.product_id, p.name AS product_name, p.sku
         FROM product_images i JOIN products p ON p.id = i.product_id
        WHERE i.kind = 'original' AND i.sha256 IN (${marks}) ORDER BY i.id`
    )
    .all(...hashes) as Row[];
  return rows.map((r) => ({
    sha256: String(r.sha256), image_id: Number(r.image_id), product_id: Number(r.product_id),
    product_name: String(r.product_name ?? ""), sku: String(r.sku ?? ""),
  }));
}

/** Original photos saved before duplicate detection existed: their hash is filled in on first use. */
export function originalsMissingHash(): { id: number; path: string }[] {
  return (db().prepare("SELECT id, path FROM product_images WHERE kind = 'original' AND sha256 IS NULL").all() as Row[]).map(
    (r) => ({ id: Number(r.id), path: String(r.path) })
  );
}

export function setImageHash(id: number, sha256: string) {
  db().prepare("UPDATE product_images SET sha256 = ? WHERE id = ?").run(sha256, id);
}

/** Products that hold the very same photos: [[productIds that share at least one original photo], ...]. */
export function duplicateProductGroups(): { product_ids: number[]; shared_photos: number }[] {
  const rows = db()
    .prepare("SELECT sha256, GROUP_CONCAT(DISTINCT product_id) AS ids FROM product_images WHERE kind = 'original' AND sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(DISTINCT product_id) > 1")
    .all() as Row[];
  // Merge photos that link the same products into one group.
  const groups: { ids: Set<number>; photos: number }[] = [];
  for (const r of rows) {
    const ids = String(r.ids).split(",").map(Number);
    const hit = groups.filter((g) => ids.some((i) => g.ids.has(i)));
    const merged = { ids: new Set<number>(ids), photos: 1 };
    for (const g of hit) { g.ids.forEach((i) => merged.ids.add(i)); merged.photos += g.photos; groups.splice(groups.indexOf(g), 1); }
    groups.push(merged);
  }
  return groups.map((g) => ({ product_ids: [...g.ids].sort((a, b) => a - b), shared_photos: g.photos }));
}

export function getImage(id: number): ProductImage | null {
  const r = db().prepare("SELECT * FROM product_images WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToImage(r) : null;
}

export function deleteImage(id: number): ProductImage | null {
  const img = getImage(id);
  if (!img) return null;
  db().prepare("DELETE FROM product_images WHERE id = ?").run(id);
  return img;
}

/** Unapproving a photo also takes it out of the carousel. */
export function setApproved(id: number, approved: boolean) {
  db()
    .prepare(`UPDATE product_images SET approved = ?${approved ? "" : ", carousel_pos = NULL"} WHERE id = ?`)
    .run(approved ? 1 : 0, id);
}

/**
 * Records a match score (and/or notes) on an image. Used when a person or an assistant such as Claude Code compares a
 * generated picture with the real photos. Only the fields that are passed are changed.
 */
export function setFidelity(id: number, f: { score?: number | null; notes?: string | null }) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (f.score !== undefined) { sets.push("fidelity_score = ?"); vals.push(f.score); }
  if (f.notes !== undefined) { sets.push("fidelity_notes = ?"); vals.push(f.notes); }
  if (!sets.length) return;
  db().prepare(`UPDATE product_images SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function makePrimary(id: number) {
  const img = getImage(id);
  if (!img) return;
  db()
    .prepare(
      `UPDATE product_images
         SET sort_order = (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM product_images WHERE product_id = ?)
       WHERE id = ?`
    )
    .run(img.product_id, id);
}

export function listCarousel(productId: number): ProductImage[] {
  const rows = db()
    .prepare(
      "SELECT * FROM product_images WHERE product_id = ? AND approved = 1 AND carousel_pos IS NOT NULL ORDER BY carousel_pos, id"
    )
    .all(productId) as Row[];
  return rows.map(rowToImage);
}

/**
 * Replaces the carousel with these image ids, in order. Only approved photos of this product, max 10.
 * Transparent cut-outs are design assets (posters, Canva), never slides on their own.
 */
export function setCarousel(productId: number, ids: number[], max: number): number[] {
  const d = db();
  const ok = new Set(
    (d.prepare("SELECT id FROM product_images WHERE product_id = ? AND approved = 1 AND kind != 'cutout'").all(productId) as Row[]).map(
      (r) => Number(r.id)
    )
  );
  const final = [...new Set(ids)].filter((id) => ok.has(id)).slice(0, max);
  d.exec("BEGIN");
  try {
    d.prepare("UPDATE product_images SET carousel_pos = NULL WHERE product_id = ?").run(productId);
    const upd = d.prepare("UPDATE product_images SET carousel_pos = ? WHERE id = ?");
    final.forEach((id, i) => upd.run(i, id));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return final;
}

export function adjustStock(productId: number, delta: number, reason: string): Product | null {
  const p = getProduct(productId);
  if (!p) return null;
  const next = Math.max(0, p.stock_qty + delta);
  const d = db();
  d.prepare("UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?").run(next, productId);
  d.prepare("INSERT INTO inventory_movements (product_id, delta, reason) VALUES (?, ?, ?)").run(
    productId, next - p.stock_qty, reason
  );
  return getProduct(productId);
}

export function listMovements(productId: number) {
  const rows = db()
    .prepare("SELECT delta, reason, at FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT 20")
    .all(productId) as Row[];
  // node:sqlite rows have a null prototype, which Next can't pass to client components.
  return rows.map((r) => ({ delta: Number(r.delta), reason: String(r.reason), at: String(r.at) }));
}
