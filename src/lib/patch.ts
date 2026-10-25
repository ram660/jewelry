import { ProductPatch } from "./productPatch.ts";

/** Validation for product edits, as a result object. The schema itself lives in productPatch.ts. */
export type ParsedPatch = { ok: true; data: Record<string, unknown> } | { ok: false; problems: string[] };

export function parseProductPatch(input: unknown): ParsedPatch {
  const r = ProductPatch.safeParse(input);
  if (r.success) return { ok: true, data: r.data as Record<string, unknown> };
  return { ok: false, problems: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) };
}
