import { falBase } from "../config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const auth = () => ({ Authorization: `Key ${process.env.FAL_KEY}` });

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const d = j.detail ?? j.error ?? j.message;
    if (typeof d === "string") return d;
    if (d) return JSON.stringify(d).slice(0, 300);
  } catch {
    // not JSON
  }
  return text.slice(0, 300);
}

async function fail(res: Response, what: string): Promise<never> {
  const detail = await errorDetail(res);
  if (res.status === 401) throw new Error("fal.ai rejected the API key. Check FAL_KEY in .env.local.");
  throw new Error(`fal.ai ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

/** fal returns follow-up URLs; only send our key to the host we submitted to. */
function sameHost(url: string, base: string) {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

/**
 * Runs a fal.ai model through the queue API: submit, poll until COMPLETED, fetch the result.
 * https://fal.ai/docs/model-apis/model-endpoints/queue
 */
export async function falRun<T>(endpoint: string, input: object, timeoutMs = 170_000): Promise<T> {
  const base = falBase();
  const submit = await fetch(`${base}/${endpoint}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submit.ok) return fail(submit, "request");

  const job = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!job.status_url || !job.response_url || !sameHost(job.status_url, base) || !sameHost(job.response_url, base)) {
    throw new Error("fal.ai returned an unexpected reply.");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await fetch(job.status_url, { headers: auth() });
    if (!st.ok) return fail(st, "status check");
    const s = (await st.json()) as { status?: string; error?: string };
    if (s.status === "COMPLETED") {
      if (s.error) throw new Error(`fal.ai could not run this: ${s.error}`);
      break;
    }
    if (Date.now() > deadline) throw new Error("fal.ai took too long. Try again in a minute.");
    await sleep(1500);
  }

  const res = await fetch(job.response_url, { headers: auth() });
  if (!res.ok) return fail(res, "result");
  return (await res.json()) as T;
}

const FAL_HOSTS = [".fal.media", ".fal.ai", ".fal.run"];

/** Downloads a result image. Only https URLs on fal's own domains (or the test mock) are fetched. */
export async function falDownload(url: string, maxBytes = 30_000_000): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("fal.ai returned a bad image link.");
  }
  const trusted =
    (u.protocol === "https:" && FAL_HOSTS.some((h) => u.hostname === h.slice(1) || u.hostname.endsWith(h))) ||
    sameHost(url, falBase());
  if (!trusted) throw new Error("fal.ai returned an image link on an unexpected host.");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the result image (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("The result image is unexpectedly large.");
  return buf;
}

export interface FalImages {
  images?: { url: string; width?: number; height?: number; content_type?: string }[];
  has_nsfw_concepts?: boolean[];
}
