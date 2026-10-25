// Compares AI models on EFJ Studio's two real vision jobs, using the app's own prompts. Costs nothing on :free models.
//
//   OPENROUTER_API_KEY=... node scripts/bench-models.mts <model-id> [<model-id> ...]
//   OPENROUTER_API_KEY=... node scripts/bench-models.mts --free        every free model that reads images and answers in text
//
// Job 1, product analysis: read a photo and write details, captions and hashtags (src/lib/ai.ts prompt + docs/BRAND.md).
//   Scored on 15 checks: valid JSON, all keys, three names and captions, hashtag format, short description length, no banned claims,
//   emojis from the allowed set, no price in captions, the visible stone noticed, no invented metal, Canadian spelling, and so on.
// Job 2, match check: score a faithful redraw and two altered ones (src/lib/visuals.ts prompt). A good model gives the faithful one
//   a high score and the altered ones a low score.
//
// The test pictures are drawn shapes, not real photos, so treat the results as a first filter, then try a short list on your own photos.
// The key is read from the environment only and is never printed or saved.
import { register } from "node:module";
import fs from "node:fs";
import sharp from "sharp";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (/^[.][.]?[/]/.test(s) && !/[.]\\w+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
}`),
  import.meta.url
);

const { buildPrompt } = await import("../src/lib/ai.ts");
const { scanText, scanHashtag } = await import("../src/lib/claims.ts");
const { parseJsonLoose } = await import("../src/lib/json.ts");

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("Set OPENROUTER_API_KEY in the environment."); process.exit(1); }
const scrub = (s: unknown) => String(s).split(KEY).join("[key]");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- test pictures (drawn): the real photo, a faithful redraw, and two altered pieces
const W = 1000, H = 1000;
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e08a"/><stop offset=".5" stop-color="#c9951f"/><stop offset="1" stop-color="#8a5f0e"/></linearGradient>
  <linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f4f4"/><stop offset=".5" stop-color="#b9bcc2"/><stop offset="1" stop-color="#7d8189"/></linearGradient>
  <radialGradient id="b" cx=".4" cy=".4"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9fd0ff"/></radialGradient></defs>`;
const wood = Array.from({ length: 50 }, (_, i) => { const c = 90 + ((i * 37) % 70); return `<rect x="0" y="${i * 20}" width="${W}" height="21" fill="rgb(${c + 40},${c},${c - 30})"/>`; }).join("");
const cream = `<rect width="${W}" height="${H}" fill="#f6efe2"/>`;
const ring = (band: number, stroke = "url(#g)") => `<circle cx="500" cy="560" r="260" fill="none" stroke="${stroke}" stroke-width="${band}"/>`;
const stone = (x = 500, y = 290, r = 70, stroke = "url(#g)") => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#b)" stroke="${stroke}" stroke-width="14"/>`;
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs}${body}</svg>`);
const jpeg = (b: Buffer) => sharp(b).jpeg({ quality: 85 }).toBuffer();
const pics = {
  real: await jpeg(svg(wood + ring(72) + stone())),
  faithful: await jpeg(svg(cream + ring(72) + stone())), // same piece, new backdrop
  thinner: await jpeg(svg(cream + ring(18))), // much thinner band and the stone is gone
  silver: await jpeg(svg(cream + ring(72, "url(#s)") + stone(380, 300, 55, "url(#s)") + stone(620, 300, 55, "url(#s)"))), // silver, two stones
};
const url = (b: Buffer) => "data:image/jpeg;base64," + b.toString("base64");

// ---- model calls
interface Reply { ok: boolean; text: string; ms: number; status: number; tokens?: string; cost?: number; note?: string }
async function chat(model: string, content: unknown[], maxTokens: number): Promise<Reply> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0 }), signal: AbortSignal.timeout(240_000),
      });
      const j = (await r.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } } | null;
      if (r.status === 429 && attempt < 2) { await sleep(15_000); continue; }
      const text = j?.choices?.[0]?.message?.content ?? "";
      return {
        ok: r.ok && text.trim().length > 0, text, ms: Date.now() - t0, status: r.status,
        tokens: j?.usage ? `${j.usage.prompt_tokens}/${j.usage.completion_tokens}` : undefined, cost: j?.usage?.cost,
        note: r.ok ? (text.trim() ? undefined : "empty answer (token budget used up thinking)") : scrub(j?.error?.message ?? `HTTP ${r.status}`).slice(0, 120),
      };
    } catch (e) {
      if (attempt === 2) return { ok: false, text: "", ms: Date.now() - t0, status: 0, note: scrub(e instanceof Error ? e.message : String(e)).slice(0, 120) };
    }
  }
  return { ok: false, text: "", ms: 0, status: 0, note: "gave up" };
}

// ---- Job 1: analysis
const brand = fs.readFileSync("docs/BRAND.md", "utf8");
const product = { name: "Aria ring", base_metal: "", sizes: "", price_cad: null } as never;
const analysisPrompt = buildPrompt(product, brand);
const KEYS = ["category", "subcategory", "gender", "colour_finish", "stones", "name_suggestions", "style_tags", "occasion_tags", "short_desc", "long_desc", "care_notes", "captions", "hashtags", "alt_text", "owner_questions"];
const ALLOWED_EMOJI = ["✨", "💛", "🤍", "🎁", "📦", "🌿"];

function gradeAnalysis(text: string): { passed: number; total: number; failed: string[] } {
  const checks: [string, boolean][] = [];
  let o: Record<string, unknown> | null = null;
  try { const v = parseJsonLoose(text); o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { o = null; }
  const arr = (k: string): string[] => (Array.isArray(o?.[k]) ? (o![k] as unknown[]).map(String) : []);
  const str = (k: string) => (typeof o?.[k] === "string" ? (o![k] as string) : "");
  checks.push(["valid JSON", !!o]);
  checks.push(["all 15 keys", !!o && KEYS.every((k) => k in o!)]);
  checks.push(["3 names", arr("name_suggestions").length === 3]);
  checks.push(["3+ captions", arr("captions").length >= 3]);
  const tags = arr("hashtags");
  checks.push(["10-14 hashtags with #", tags.length >= 10 && tags.length <= 14 && tags.every((t) => t.startsWith("#"))]);
  checks.push(["short_desc <= 20 words", str("short_desc").split(/\s+/).filter(Boolean).length > 0 && str("short_desc").split(/\s+/).filter(Boolean).length <= 20]);
  const copy = [str("short_desc"), str("long_desc"), str("care_notes"), str("alt_text"), ...arr("captions"), ...arr("name_suggestions"), ...arr("style_tags"), ...arr("occasion_tags")];
  checks.push(["no banned claims", !!o && copy.every((t) => scanText(t).length === 0) && tags.every((t) => scanHashtag(t).length === 0)]);
  const caps = arr("captions");
  const emojiOk = caps.length > 0 && caps.every((c) => { const e = c.match(/\p{Extended_Pictographic}/gu) ?? []; return e.length <= 2 && e.every((x) => ALLOWED_EMOJI.includes(x)); });
  checks.push(["emojis allowed, max 2", emojiOk]);
  checks.push(["no price in captions", caps.length > 0 && caps.every((c) => !/\$|\bCAD\b/i.test(c))]);
  checks.push(["captions have no hashtags", caps.length > 0 && caps.every((c) => !c.includes("#"))]);
  checks.push(["saw the blue stone", /blue|pale|light/i.test(str("stones") + str("long_desc") + str("alt_text"))]);
  checks.push(["category ring or set", ["ring", "set"].includes(str("category"))]);
  checks.push(["did not invent a base metal", !!o && !/brass|sterling|stainless|copper|solid gold/i.test(copy.join(" "))]);
  checks.push(["asks the owner about unknowns", arr("owner_questions").some((q) => /metal|size|nickel|weight|plating/i.test(q))]);
  checks.push(["Canadian spelling, says 10K gold-plated", !/jewelry/i.test(copy.join(" ")) && /10K gold-plated/i.test(str("long_desc"))]);
  return { passed: checks.filter(([, ok]) => ok).length, total: checks.length, failed: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}

// ---- Job 2: match check (the app's own wording)
const matchPrompt = `The first 1 image(s) are REAL photos of one piece of jewellery. The last image is an AI-generated picture that should show the SAME piece.
Compare only the jewellery itself (ignore background, hands, lighting). Check: overall shape, number and placement of stones, chain/link pattern, clasp or band style, thickness, colour and gold tone, and that nothing was added or removed.
Reply with ONLY JSON: {"score": 0-100 (100 = identical piece), "issues": ["short, specific differences; empty if none"]}`;
function scoreOf(text: string): number | null {
  try { const v = parseJsonLoose(text) as { score?: unknown }; const n = Number(v?.score); return Number.isFinite(n) ? Math.round(n) : null; } catch { return null; }
}

// ---- run
interface Row { model: string; analysis: string; fails: string; aMs: number; faithful: number | null; thinner: number | null; silver: number | null; mMs: number; cost: number; notes: string[] }
async function bench(model: string): Promise<Row> {
  const notes: string[] = [];
  let cost = 0;
  const a = await chat(model, [{ type: "text", text: analysisPrompt }, { type: "image_url", image_url: { url: url(pics.real) } }], 6000);
  cost += a.cost ?? 0;
  const g = a.ok ? gradeAnalysis(a.text) : { passed: 0, total: 15, failed: [a.note ?? "failed"] };
  if (!a.ok) notes.push("analysis: " + (a.note ?? "failed"));
  const scores: Record<string, number | null> = {};
  let mMs = 0;
  for (const k of ["faithful", "thinner", "silver"] as const) {
    const m = await chat(model, [{ type: "text", text: matchPrompt }, { type: "image_url", image_url: { url: url(pics.real) } }, { type: "image_url", image_url: { url: url(pics[k]) } }], 3000);
    cost += m.cost ?? 0; mMs += m.ms;
    scores[k] = m.ok ? scoreOf(m.text) : null;
    if (!m.ok) notes.push(`match ${k}: ` + (m.note ?? "failed"));
  }
  return { model, analysis: `${g.passed}/${g.total}`, fails: g.failed.join("; "), aMs: a.ms, faithful: scores.faithful, thinner: scores.thinner, silver: scores.silver, mMs, cost, notes };
}

let models = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--free")) {
  const all = ((await (await fetch("https://openrouter.ai/api/v1/models")).json()) as { data: { id: string; pricing?: { prompt?: string; completion?: string }; architecture?: { input_modalities?: string[]; output_modalities?: string[] } }[] }).data;
  models = all.filter((x) => /:free$/.test(x.id) && Number(x.pricing?.prompt) === 0 && x.architecture?.input_modalities?.includes("image") && x.architecture?.output_modalities?.join() === "text").map((x) => x.id);
}
if (!models.length) { console.error("Give model ids, or --free."); process.exit(1); }
console.log(`Testing ${models.length} model(s). Free models allow 20 requests a minute and 50 a day until credits are bought; each model uses 4 requests.\n`);

const rows: Row[] = [];
for (const m of models) {
  process.stdout.write(`${m} ... `);
  const r = await bench(m);
  rows.push(r);
  console.log(`analysis ${r.analysis}, match faithful ${r.faithful ?? "-"} / thinner ${r.thinner ?? "-"} / silver ${r.silver ?? "-"}`);
  await sleep(4000);
}

console.log("\nModel".padEnd(53) + "Analysis".padEnd(10) + "Read(s)".padEnd(9) + "Same".padEnd(6) + "Thin".padEnd(6) + "Silver".padEnd(8) + "Match(s)".padEnd(10) + "Cost");
for (const r of rows) {
  console.log(r.model.padEnd(52) + " " + r.analysis.padEnd(10) + (r.aMs / 1000).toFixed(0).padEnd(9) + String(r.faithful ?? "-").padEnd(6) + String(r.thinner ?? "-").padEnd(6) + String(r.silver ?? "-").padEnd(8) + (r.mMs / 1000).toFixed(0).padEnd(10) + "$" + r.cost.toFixed(4));
}
console.log("\nWhat each model missed in the analysis, and any errors:");
for (const r of rows) console.log(`- ${r.model}: ${r.fails || "nothing"}${r.notes.length ? "  | " + r.notes.join(" | ") : ""}`);
console.log("\nA good match check scores the faithful picture high (80+) and both altered pictures low (under 60).");
