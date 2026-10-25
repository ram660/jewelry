import { findOriginalsByHash } from "./db";
import { ensureHashes, fingerprint } from "./storage";

export interface DuplicateUpload {
  /** File name as the browser sent it. */
  file: string;
  product_id: number;
  product_name: string;
  sku: string;
}

export interface DuplicateReport {
  /** Photos already in the catalog, and the product that holds each. */
  existing: DuplicateUpload[];
  /** Photos that appear more than once in this very upload. */
  repeated: string[];
}

/**
 * Looks for photos in this upload that the catalog already has, or that are in the upload twice. The same photo always
 * has the same fingerprint, so a re-upload (for example after a failed AI step) cannot create a second product.
 */
export async function findDuplicateUploads(files: File[]): Promise<DuplicateReport> {
  await ensureHashes();
  const hashes = await Promise.all(files.map(async (f) => fingerprint(Buffer.from(await f.arrayBuffer()))));

  const seen = new Set<string>();
  const repeated: string[] = [];
  hashes.forEach((h, i) => {
    if (seen.has(h)) repeated.push(files[i].name || `photo ${i + 1}`);
    seen.add(h);
  });

  const hits = findOriginalsByHash([...seen]);
  const firstHit = new Map<string, (typeof hits)[number]>();
  for (const h of hits) if (!firstHit.has(h.sha256)) firstHit.set(h.sha256, h);

  const existing: DuplicateUpload[] = [];
  hashes.forEach((h, i) => {
    const hit = firstHit.get(h);
    if (hit) existing.push({ file: files[i].name || `photo ${i + 1}`, product_id: hit.product_id, product_name: hit.product_name, sku: hit.sku });
  });
  return { existing, repeated };
}

/** A plain-language sentence for the people who see it. */
export function describeDuplicates(r: DuplicateReport): string {
  const parts: string[] = [];
  if (r.existing.length) {
    const where = [...new Map(r.existing.map((e) => [e.product_id, e])).values()]
      .map((e) => `${e.product_name || e.sku} (#${e.product_id})`)
      .join(", ");
    parts.push(`${r.existing.length === 1 ? "This photo is" : `${r.existing.length} of these photos are`} already in ${where}.`);
  }
  if (r.repeated.length) parts.push(`${r.repeated.length === 1 ? "One photo is" : `${r.repeated.length} photos are`} in this upload more than once.`);
  return parts.join(" ");
}
