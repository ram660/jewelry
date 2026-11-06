/**
 * Free stock photos and videos for education and mood content (layering guides, care tips, occasion boards, Reels B-roll).
 * Uses the official APIs of Pexels, Pixabay and Unsplash, never page scraping. Keys come from .env.local:
 *   PEXELS_API_KEY, PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY  (all free; a site without a key is skipped)
 *
 * Stock pictures are never the shop's products. They must not be shown as pieces for sale or described with the
 * shop's product wording. scripts/stock-images.mts writes a credits.csv with the licence of every file.
 */

export type StockSite = "pexels" | "pixabay" | "unsplash";
export type StockKind = "photo" | "search" | "collection";
export type StockMedia = "image" | "video";

export interface StockLink {
  site: StockSite;
  kind: StockKind;
  media: StockMedia;
  /** photo/video id, collection id, or the search words */
  value: string;
  /** extra search filters copied from the link (Pixabay orientation) */
  orientation?: string;
}

export interface StockItem {
  site: StockSite;
  media: StockMedia;
  id: string;
  url: string;
  ext: string;
  pageUrl: string;
  author: string;
  description: string;
  licence: string;
  /** Unsplash asks apps to call this when a photo is downloaded */
  trackUrl?: string;
}

export const LICENCES: Record<StockSite, string> = {
  pexels: "Pexels License (https://www.pexels.com/license/)",
  pixabay: "Pixabay Content License (https://pixabay.com/service/license-summary/)",
  unsplash: "Unsplash License (https://unsplash.com/license)",
};

export const KEY_NAMES: Record<StockSite, string> = {
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
  unsplash: "UNSPLASH_ACCESS_KEY",
};

const words = (s: string) => decodeURIComponent(s).replace(/[-+]/g, " ").replace(/\s+/g, " ").trim();
const trailingNumber = (s: string) => s.match(/(\d+)\/?$/)?.[1] ?? "";

/** Understands photo, video, search and collection links. Returns null for anything else. Pure: safe in tests. */
export function parseStockLink(link: string): StockLink | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "pexels.com") {
    const [a, b, c] = parts[0]?.length === 5 && /^[a-z]{2}-[a-z]{2}$/i.test(parts[0]) ? parts.slice(1) : parts; // /en-ca/...
    if (a === "photo" && b && trailingNumber(b)) return { site: "pexels", kind: "photo", media: "image", value: trailingNumber(b) };
    if (a === "video" && b && trailingNumber(b)) return { site: "pexels", kind: "photo", media: "video", value: trailingNumber(b) };
    if (a === "search" && b === "videos" && c) return { site: "pexels", kind: "search", media: "video", value: words(c) };
    if (a === "search" && b) return { site: "pexels", kind: "search", media: "image", value: words(b) };
    if (a === "collections" && b) return { site: "pexels", kind: "collection", media: "image", value: b.split("-").pop()! };
    return null;
  }

  if (host === "pixabay.com") {
    const orientation = u.searchParams.get("orientation") ?? undefined;
    const searchAt = parts.indexOf("search");
    if (searchAt >= 0 && parts[searchAt + 1]) {
      const media: StockMedia = parts[0] === "videos" ? "video" : "image";
      return { site: "pixabay", kind: "search", media, value: words(parts[searchAt + 1]), orientation };
    }
    const last = parts.at(-1) ?? "";
    if (["photos", "illustrations", "vectors", "videos"].includes(parts[0] ?? "") && trailingNumber(last)) {
      return { site: "pixabay", kind: "photo", media: parts[0] === "videos" ? "video" : "image", value: trailingNumber(last) };
    }
    return null;
  }

  if (host === "unsplash.com") {
    if (parts[0] === "photos" && parts[1]) return { site: "unsplash", kind: "photo", media: "image", value: parts[1].split("-").pop()! };
    if (parts[0] === "s" && parts[1] === "photos" && parts[2]) return { site: "unsplash", kind: "search", media: "image", value: words(parts[2]) };
    return null;
  }
  return null;
}

/** Builds a search link from plain words, so a theme list can say "pixabay: pearl earrings". */
export function searchLink(site: StockSite, query: string, media: StockMedia = "image"): string {
  const q = encodeURIComponent(query.trim());
  if (site === "pexels") return `https://www.pexels.com/search/${media === "video" ? "videos/" : ""}${q}/`;
  if (site === "pixabay") return `https://pixabay.com/${media === "video" ? "videos" : "images"}/search/${q}/`;
  return `https://unsplash.com/s/photos/${q}`;
}

/** True when the text mentions at least one of the words (used to drop off-topic results). */
export function mentionsAny(text: string, mustWords: string[]): boolean {
  if (!mustWords.length) return true;
  const t = text.toLowerCase();
  return mustWords.some((w) => t.includes(w.toLowerCase()));
}

/** Pixabay tags AI pictures "ai generated"; they are skipped by default because they may not show real jewellery. */
export function isAiGenerated(item: Pick<StockItem, "description">): boolean {
  return /\b(ai[- ]generated|generative ai|ai art|midjourney|stable diffusion)\b/i.test(item.description);
}

// ---------------------------------------------------------------- network

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(site: StockSite): string {
  const k = process.env[KEY_NAMES[site]];
  if (!k) throw new Error(`${KEY_NAMES[site]} is not set in .env.local (free key, see .env.example).`);
  return k;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "EFJ-Studio", ...headers } });
    if (res.status === 429 && attempt < 4) {
      await sleep((Number(res.headers.get("retry-after")) || 5 * 2 ** attempt) * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${new URL(url).hostname} rejected the API key (${res.status}).`);
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}.`);
    return res.json();
  }
}

const extOf = (url: string, fallback: string) => new URL(url).pathname.match(/\.(\w{3,4})$/)?.[1]?.toLowerCase() ?? fallback;

// Pexels
const pexelsHeaders = () => ({ Authorization: key("pexels") });
function pexelsPhoto(p: any): StockItem {
  return { site: "pexels", media: "image", id: String(p.id), url: p.src.original, ext: extOf(p.src.original, "jpg"),
    pageUrl: p.url ?? "", author: p.photographer ?? "", description: p.alt ?? "", licence: LICENCES.pexels };
}
function pexelsVideo(v: any): StockItem | null {
  const files = (v.video_files ?? []).filter((f: any) => f.file_type === "video/mp4" && f.width);
  // largest file up to 1920 wide: enough for Reels, not a 4K download
  const best = files.filter((f: any) => Math.min(f.width, f.height) <= 1080).sort((a: any, b: any) => b.width - a.width)[0] ?? files[0];
  if (!best) return null;
  return { site: "pexels", media: "video", id: String(v.id), url: best.link, ext: "mp4", pageUrl: v.url ?? "",
    author: v.user?.name ?? "", description: words(String(v.url ?? "").split("/").filter(Boolean).pop() ?? "").replace(/\s\d+$/, ""),
    licence: LICENCES.pexels };
}

async function fromPexels(link: StockLink, limit: number): Promise<StockItem[]> {
  const h = pexelsHeaders();
  if (link.kind === "photo") {
    return link.media === "video"
      ? [pexelsVideo(await getJson(`https://api.pexels.com/videos/videos/${link.value}`, h))].filter((x): x is StockItem => !!x)
      : [pexelsPhoto(await getJson(`https://api.pexels.com/v1/photos/${link.value}`, h))];
  }
  const out: StockItem[] = [];
  for (let page = 1; out.length < limit; page++) {
    const q = encodeURIComponent(link.value);
    const url = link.kind === "collection"
      ? `https://api.pexels.com/v1/collections/${link.value}?type=photos&per_page=80&page=${page}`
      : link.media === "video"
        ? `https://api.pexels.com/videos/search?query=${q}&per_page=80&page=${page}`
        : `https://api.pexels.com/v1/search?query=${q}&per_page=80&page=${page}`;
    const data = await getJson(url, h);
    const raw: any[] = data.media ?? data.videos ?? data.photos ?? [];
    const items = link.media === "video"
      ? raw.map(pexelsVideo).filter((x): x is StockItem => !!x)
      : raw.filter((p) => (p.type ?? "Photo") === "Photo").map(pexelsPhoto);
    out.push(...items);
    if (!data.next_page || !raw.length) break;
  }
  return out.slice(0, limit);
}

// Pixabay
function pixabayItem(h: any, media: StockMedia): StockItem | null {
  if (media === "video") {
    const v = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
    if (!v?.url) return null;
    return { site: "pixabay", media, id: String(h.id), url: v.url, ext: "mp4", pageUrl: h.pageURL ?? "",
      author: h.user ?? "", description: h.tags ?? "", licence: LICENCES.pixabay };
  }
  const url: string = h.imageURL || h.largeImageURL; // imageURL (full size) needs full API access
  return { site: "pixabay", media, id: String(h.id), url, ext: extOf(url, "jpg"), pageUrl: h.pageURL ?? "",
    author: h.user ?? "", description: h.tags ?? "", licence: LICENCES.pixabay };
}

async function fromPixabay(link: StockLink, limit: number): Promise<StockItem[]> {
  const base = `https://pixabay.com/api/${link.media === "video" ? "videos/" : ""}?key=${encodeURIComponent(key("pixabay"))}&safesearch=true`;
  if (link.kind === "photo") {
    const data = await getJson(`${base}&id=${link.value}`);
    return (data.hits ?? []).map((h: any) => pixabayItem(h, link.media)).filter((x: StockItem | null): x is StockItem => !!x);
  }
  const out: StockItem[] = [];
  for (let page = 1; out.length < limit; page++) {
    let url = `${base}&q=${encodeURIComponent(link.value)}&per_page=200&page=${page}`;
    if (link.media === "image") url += "&image_type=photo";
    if (link.orientation) url += `&orientation=${encodeURIComponent(link.orientation)}`;
    const data = await getJson(url);
    const hits: any[] = data.hits ?? [];
    out.push(...hits.map((h) => pixabayItem(h, link.media)).filter((x): x is StockItem => !!x));
    if (!hits.length || page * 200 >= Math.min(data.totalHits ?? 0, 500)) break; // Pixabay stops at 500 per search
  }
  return out.slice(0, limit);
}

// Unsplash
const unsplashHeaders = () => ({ Authorization: `Client-ID ${key("unsplash")}`, "Accept-Version": "v1" });
function unsplashPhoto(p: any): StockItem {
  return { site: "unsplash", media: "image", id: p.id, url: `${p.urls.raw}&fm=jpg&q=90`, ext: "jpg",
    pageUrl: p.links?.html ?? "", author: p.user?.name ?? "", description: p.alt_description ?? p.description ?? "",
    licence: LICENCES.unsplash, trackUrl: p.links?.download_location };
}

async function fromUnsplash(link: StockLink, limit: number): Promise<StockItem[]> {
  const h = unsplashHeaders();
  if (link.kind === "photo") return [unsplashPhoto(await getJson(`https://api.unsplash.com/photos/${link.value}`, h))];
  const out: StockItem[] = [];
  for (let page = 1; out.length < limit; page++) {
    const data = await getJson(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(link.value)}&per_page=30&page=${page}`, h);
    const res: any[] = data.results ?? [];
    out.push(...res.map(unsplashPhoto));
    if (!res.length || page >= (data.total_pages ?? 0)) break;
  }
  return out.slice(0, limit);
}

export async function findStock(link: StockLink, limit: number): Promise<StockItem[]> {
  if (link.site === "pexels") return fromPexels(link, limit);
  if (link.site === "pixabay") return fromPixabay(link, limit);
  return fromUnsplash(link, limit);
}

/** Downloads one file to `dest` (written as dest.part first). Waits and retries when the site says "too many requests". */
export async function downloadStock(item: StockItem, dest: string, write: (path: string, data: Uint8Array) => Promise<void>): Promise<void> {
  if (item.trackUrl) await fetch(item.trackUrl, { headers: unsplashHeaders() }).catch(() => undefined);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(item.url, { headers: { "User-Agent": "EFJ-Studio" } });
    if (res.status === 429 && attempt < 5) {
      await sleep((Number(res.headers.get("retry-after")) || 5 * 2 ** attempt) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    await write(dest, new Uint8Array(await res.arrayBuffer()));
    return;
  }
}
