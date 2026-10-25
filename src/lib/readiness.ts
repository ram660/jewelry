import { getProduct, listImages, updateProduct } from "./db";
import { READY_STATES, checkProduct } from "./claims";

/** Approved photos only: an unapproved AI picture is not something the shop can post. */
export function approvedPhotoCount(productId: number): number {
  return listImages(productId).filter((i) => i.approved).length;
}

/**
 * Re-checks a ready / scheduled / posted product after something it depends on changed (a photo was removed or
 * un-approved). If a blocking problem appeared, the product goes back to draft. Returns true when it was demoted.
 */
export function demoteIfBlocked(productId: number): boolean {
  const p = getProduct(productId);
  if (!p || !READY_STATES.includes(p.status)) return false;
  const blocked = checkProduct(p, approvedPhotoCount(productId)).some((x) => x.level === "block");
  if (blocked) updateProduct(productId, { status: "draft" });
  return blocked;
}
