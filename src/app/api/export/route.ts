import { listProducts } from "@/lib/db";

export const runtime = "nodejs";

const COLUMNS = [
  "sku", "name", "category", "subcategory", "gender", "status", "price_cad", "cost_cad", "stock_qty",
  "plating", "base_metal", "plating_microns", "nickel_free", "colour_finish", "stones", "sizes", "weight_g",
  "short_desc", "long_desc", "care_notes", "style_tags", "occasion_tags", "hashtags", "created_at",
] as const;

// Spreadsheet apps run text starting with = + - @ as a formula; prefix those with an apostrophe.
function cell(v: unknown): string {
  let s = Array.isArray(v) ? v.join(" ") : v == null ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function GET() {
  const rows = listProducts().map((p) => COLUMNS.map((c) => cell(p[c as keyof typeof p])).join(","));
  const csv = String.fromCharCode(0xfeff) + [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="efj-catalog-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
