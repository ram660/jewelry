"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { draftProblems, finalCaption, planPosts, postGroup, slidesFor, storyFile, type Draft, type KitFiles, type LogEntry, type PostGroup } from "@/lib/kitDraft";
import { CATEGORIES } from "@/lib/types";
import { addToCaption, fillFromFact, pricePosition, usePrice, type RecommendationsResult } from "@/lib/recommendations";
import { priceCard, recipeLabel } from "@/lib/reelRecipes";

type StyleState = { status: "ok" | "skipped" | "unavailable"; reason?: string; mark?: boolean } | null;
interface ReelItem { file: string; recipe: string; track: string | null; at: string }
interface AiScene { file: string; style: string; score: number; low: boolean; notes: string; model: string }
interface Kit {
  slug: string; title: string; files: KitFiles; draft: Draft; log: LogEntry[]; templateCaptions: boolean; canRegenerate: boolean; hasPrevious: boolean;
  claudeStyle: StyleState; recommendations: RecommendationsResult; jobs: Record<string, string | null>;
  reels: { items: ReelItem[]; chosen: string | null }; aiScenes: AiScene[]; fidelityMin: number;
}
interface Status { ffmpeg: boolean; tracks: string[]; audioDir: string; instagram: boolean; ai: string | null; claude: boolean; gemini: boolean }
interface Job { id: string; kind: string; state: "running" | "done" | "failed"; lines: string[]; error?: string; result?: unknown }
interface Published { kind: string; status: string; permalink?: string; mediaId?: string }

const BACKDROPS: [string, string][] = [
  ["auto", "Next backdrop"], ["ivory", "Ivory"], ["gilded-frame", "Ivory, gold frame"], ["blush-arch", "Blush arch"],
  ["noir", "Deep charcoal"], ["stone", "Warm grey"], ["horizon", "Tabletop"], ["sage-frame", "Sage, silver frame"],
];

const AI_STYLES: [string, string][] = [["soft-studio", "Soft studio"], ["marble", "Marble"], ["silk", "Silk"], ["daylight", "Daylight window"]];

const LABEL: Record<PostGroup, string> = { feed: "Photo post", story: "Story", reel: "Reel" };
const KIND_LABEL: Record<string, string> = { image: "Photo post", carousel: "Photo post", story: "Story", reel: "Reel" };

/** Plain words for a request that never got an answer. */
const unreachable = (e: unknown) =>
  e instanceof TypeError ? "Couldn't reach the Studio. Check that npm run dev is still running, then try again." : e instanceof Error ? e.message : String(e);

function useJob(id: string | null, onEnd: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (!id) return setJob(null);
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/instagram/jobs/${id}`).catch(() => null);
      const j = r && r.ok ? ((await r.json()) as Job) : null;
      if (stop) return;
      if (!j) return setJob({ id, kind: "", state: "failed", lines: [], error: "Lost track of this job (the Studio may have restarted)." });
      setJob(j);
      if (j.state === "running") setTimeout(tick, 1500);
      else end.current(j);
    };
    tick();
    return () => { stop = true; };
  }, [id]);
  return job;
}

function JobLog({ job, title }: { job: Job; title: string }) {
  return (
    <div className="card pad">
      <h3>{title} {job.state === "running" ? "…" : job.state === "done" ? "✓" : "✗"}</h3>
      <pre className="ig-log">{job.lines.slice(-14).join("\n") || "Starting…"}</pre>
      {job.error && <p className="error">{job.error}</p>}
    </div>
  );
}

/** Where Reel music can come from, and what Instagram allows. Shown on the Reel tab. */
function MusicHelp() {
  return (
    <details className="ig-music-help">
      <summary>Music you can use</summary>
      <ul>
        <li><b>Instagram&apos;s own music can&apos;t be added from here.</b> Its music library (including the free Meta Sound Collection for business accounts) only works inside the Instagram app, and posts made through the API can&apos;t include it.</li>
        <li><b>Don&apos;t use popular commercial songs.</b> A business account isn&apos;t licensed for them: the Reel is likely to be muted or taken down.</li>
        <li><b>Safe choices:</b> the shop&apos;s own music beds (already in the audio folder, made for the shop and free to use), or royalty-free tracks whose licence allows commercial social-media use: YouTube Audio Library, Pixabay Music, Mixkit, Uppbeat (free tier, with its credit line), Free Music Archive (only tracks marked for commercial use).</li>
        <li>Keep a short licence note next to each track you download (where it came from and the licence), in the audio folder.</li>
      </ul>
    </details>
  );
}

function Steps({ at }: { at: number }) {
  return (
    <ol className="ig-steps">
      {["Add photos", "Review the post", "Post"].map((s, i) => <li key={s} className={i === at ? "on" : i < at ? "done" : ""}>{s}</li>)}
    </ol>
  );
}

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Market research for this kit, from recommendations.json (written by Claude in the project chat). Nothing here changes the
 * post by itself: each button fills one field, and the usual checks still run on whatever ends up in the caption.
 */
function Recommendations({ rec, draft, set, setFields }: {
  rec: RecommendationsResult;
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  setFields: (p: Partial<Draft["fields"]>) => void;
}) {
  if (rec.status !== "ok") {
    return (
      <details className="card pad ig-rec">
        <summary>Recommendations</summary>
        <p className="muted" style={{ fontSize: ".85rem" }}>
          {rec.status === "invalid"
            ? "The recommendations file for this kit couldn't be read. Ask Claude in the project chat to fetch them again."
            : "No recommendations yet. Ask Claude in the project chat to fetch them for this kit."}
        </p>
      </details>
    );
  }
  const d = rec.data;
  const typed = Number(draft.fields.price.replace(/[^0-9.]/g, ""));
  const s = d.suggestedPriceCAD;
  return (
    <details className="card pad ig-rec" open>
      <summary>Recommendations</summary>
      <p className="ig-rec-warn">From market research, not verified. Check before using.</p>

      {d.price && (
        <div className="ig-rec-block">
          <b>Similar items:</b> {d.price.currency} {money(d.price.low)} to {money(d.price.high)}, middle {money(d.price.median)} ({d.price.count} found).{" "}
          <span className="muted">Similar items, not the same product.</span>
          {d.price.note && <p className="muted" style={{ margin: ".2rem 0 0" }}>{d.price.note}</p>}
        </div>
      )}
      {s && (
        <div className="ig-rec-block">
          <b>Suggested price:</b> ${money(s.low)} to ${money(s.high)} CAD
          <div className="ig-rec-bar" aria-hidden>
            {typed > 0 && <span className="ig-rec-marker" style={{ left: `${pricePosition(typed, s.low, s.high) * 100}%` }} title={`Your price: $${money(typed)}`} />}
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: ".8rem" }}>
            <span>${money(s.low)}</span>
            <span className="muted">{typed > 0 ? `Your price $${money(typed)}${typed < s.low ? " (below)" : typed > s.high ? " (above)" : ""}` : "No price typed yet"}</span>
            <span>${money(s.high)}</span>
          </div>
          <div className="row" style={{ marginTop: ".3rem" }}>
            {[...new Set([s.low, s.high])].map((n) => (
              <button key={n} className="btn ghost" onClick={() => setFields(usePrice(n))}>Use ${money(n)}</button>
            ))}
          </div>
          {s.note && <p className="muted" style={{ margin: ".3rem 0 0" }}>{s.note}</p>}
        </div>
      )}
      {d.descriptionIdeas.length > 0 && (
        <div className="ig-rec-block">
          <b>Ideas for the caption</b>
          <ul className="ig-rec-list">
            {d.descriptionIdeas.map((idea) => (
              <li key={idea}>
                <span>{idea}</span>
                <button className="btn ghost" onClick={() => set({ caption: addToCaption(draft.caption, idea) })}>Add to caption</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.productFacts.length > 0 && (
        <div className="ig-rec-block">
          <b>Product facts</b>
          <ul className="ig-rec-list">
            {d.productFacts.map((f) => {
              const fill = fillFromFact(f);
              return (
                <li key={f.label}>
                  <span>
                    {f.label}: {f.value || <span className="muted">unknown</span>}{" "}
                    <span className={`badge ${f.confirmed ? "ig-ok" : "ig-unconfirmed"}`}>{f.confirmed ? "confirmed" : "not confirmed"}</span>
                  </span>
                  {fill && <button className="btn ghost" onClick={() => setFields(fill)}>Fill</button>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {d.toConfirm.length > 0 && (
        <div className="ig-rec-block">
          <b>To confirm before posting</b>
          <ul>{d.toConfirm.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>
        {d.sources.join(" · ")}{d.generatedAt ? ` · ${d.generatedAt}` : ""}{rec.dropped ? ` · ${rec.dropped} line(s) left out by the wording check` : ""}
      </p>
    </details>
  );
}

/** Steps 2 and 3: review the post the AI wrote on a phone preview, fix anything, then post it. */
export default function KitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const search = useSearchParams();
  const [kit, setKit] = useState<Kit | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<PostGroup>("feed");
  const [more, setMore] = useState(false);
  const [slide, setSlide] = useState(0);
  const [kitJob, setKitJob] = useState<string | null>(search.get("job"));
  const [reelJob, setReelJob] = useState<string | null>(null);
  const [pubJob, setPubJob] = useState<string | null>(null);
  const [reelStamp, setReelStamp] = useState(0);
  const [rewriting, setRewriting] = useState(false);
  const [regenJob, setRegenJob] = useState<string | null>(null);
  const [aiJob, setAiJob] = useState<string | null>(null);
  const [aiCount, setAiCount] = useState<1 | 2>(1);
  const [aiStyle, setAiStyle] = useState("soft-studio");
  const [backdrop, setBackdrop] = useState("auto");
  const [dropDark, setDropDark] = useState(false);
  // Changes whenever the images are made again, so the browser shows the new ones.
  const [imgStamp, setImgStamp] = useState(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const [k, s] = await Promise.all([fetch(`/api/instagram/kits/${slug}`), fetch("/api/instagram/kits")]);
    if (!k.ok) return setError((await k.json().catch(() => ({}))).error || "Could not load this kit.");
    const kj = (await k.json()) as Kit;
    setKit(kj);
    setStatus(await s.json());
    setDraft((d) => (loaded.current && d ? d : kj.draft));
    loaded.current = true;
    if (kj.jobs.kit) setKitJob(kj.jobs.kit);
    if (kj.jobs.reel) setReelJob(kj.jobs.reel);
    if (kj.jobs.regen) setRegenJob(kj.jobs.regen);
    if (kj.jobs.publish) setPubJob(kj.jobs.publish);
    if (kj.jobs.ai) setAiJob(kj.jobs.ai);
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const kitRun = useJob(kitJob, () => { loaded.current = false; load(); });
  const reelRun = useJob(reelJob, () => { setReelStamp(Date.now()); load(); });
  const pubRun = useJob(pubJob, () => load());
  const regenRun = useJob(regenJob, () => { setImgStamp(Date.now()); load(); });
  const aiRun = useJob(aiJob, () => load());

  // Edits are saved as you go, so a reload keeps them.
  useEffect(() => {
    if (!draft || !loaded.current) return;
    const t = setTimeout(() => {
      fetch(`/api/instagram/kits/${slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [draft, slug]);

  if (error) return <p className="error">{error} <Link href="/instagram">Back to Instagram</Link></p>;
  const making = kitRun?.state === "running";
  if (!kit || !draft || !status || making || (!kit.files.main.length && kitRun)) {
    return (
      <div>
        <Steps at={1} />
        {kitRun ? <JobLog job={kitRun} title="Making the photos and writing the post" /> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setFields = (patch: Partial<Draft["fields"]>) => set({ fields: { ...draft.fields, ...patch } });
  const posted = [...new Set(kit.log.map((e) => postGroup(e.kind)))] as PostGroup[];
  const problems = draftProblems(draft, kit.files, posted);
  const plan = planPosts(draft, kit.files);
  const caption = finalCaption(draft);
  const file = (n: string) => `/api/instagram/kits/${slug}/file/${n}${imgStamp ? `?v=${imgStamp}` : ""}`;
  const candidates = [...kit.files.main, ...kit.files.closeup, ...kit.files.square, ...kit.files.original, ...kit.files.ai];
  const busy = pubRun?.state === "running" || reelRun?.state === "running" || regenRun?.state === "running" || aiRun?.state === "running" || rewriting;
  const aiMeta = new Map(kit.aiScenes.map((a) => [a.file, a]));
  const isAi = (n: string) => kit.files.ai.includes(n);
  const lastReel = kit.reels.items.find((r) => r.file === kit.reels.chosen) ?? kit.reels.items[kit.reels.items.length - 1];
  const reelFile = (n: string) => `/api/instagram/kits/${slug}/file/${n}?v=${reelStamp}`;
  const story = storyFile(draft, kit.files);
  const setLook = (look: Draft["look"]) => set({ look, slides: slidesFor(look, kit.files, kit.aiScenes.filter((a) => a.low).map((a) => a.file)) });
  // The looks this kit has, side by side, each shown by its first photo.
  const allLooks: [Draft["look"], string, string | undefined][] = [
    ["studio", "Studio", kit.files.main[0]],
    ["claude", "Claude-styled", kit.files.claude[0]],
    ["original", "My original", kit.files.original[0]],
    ["ai", "AI scene", kit.files.ai[0]],
  ];
  const looks = allLooks.filter((l): l is [Draft["look"], string, string] => Boolean(l[2]));
  const cs = kit.claudeStyle;
  const claudeNote = !cs ? null : cs.status === "skipped" ? (cs.mark ? "Claude version: skipped." : `Claude version skipped: ${cs.reason}.`) : cs.status === "unavailable" ? cs.reason ?? null : null;
  const slides = draft.slides.length ? draft.slides : kit.files.main.slice(0, 1);
  const cur = Math.min(slide, slides.length - 1);
  const results = (pubRun?.result as Published[] | undefined) ?? [];
  const lines = caption.split("\n");
  const short = lines.slice(0, 2).join("\n");

  const toggleSlide = (n: string) => {
    const has = draft.slides.includes(n);
    set({ slides: has ? draft.slides.filter((s) => s !== n) : [...draft.slides, n].slice(0, 10) });
  };
  const move = (n: string, by: -1 | 1) => {
    const s = [...draft.slides];
    const i = s.indexOf(n), j = i + by;
    if (i < 0 || j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    set({ slides: s });
  };

  async function rewrite() {
    setRewriting(true);
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Rewrite failed.");
      setDraft(j as Draft);
    } catch (e) {
      alert(unreachable(e));
    } finally {
      setRewriting(false);
    }
  }

  async function regenerate(claude: boolean) {
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backdrop, dropDark, claude }) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not make the images again.");
      setRegenJob(j.jobId);
    } catch (e) {
      alert(unreachable(e));
    }
  }

  // Only ever called from the button's onClick: AI scenes are never made on upload or page load.
  async function generateAi() {
    if (!window.confirm(`Make ${aiCount} AI scene${aiCount > 1 ? "s" : ""} with Gemini?\n\nIt uses your Gemini key (a small charge per image) and takes about a minute per image.`)) return;
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/ai-scene`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: aiCount, style: aiStyle }) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not start the AI scene.");
      setAiJob(j.jobId);
    } catch (e) {
      alert(unreachable(e));
    }
  }

  async function createReel() {
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/reels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not start the Reel.");
      setReelJob(j.jobId);
    } catch (e) {
      alert(unreachable(e));
    }
  }

  async function chooseReel(name: string) {
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/reels`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: name }) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not choose that Reel.");
      setReelStamp(Date.now());
      load();
    } catch (e) {
      alert(unreachable(e));
    }
  }

  async function previous() {
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/previous`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not go back.");
      setImgStamp(Date.now());
      load();
    } catch (e) {
      alert(unreachable(e));
    }
  }

  async function buildReel() {
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/reel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const j = await r.json();
      if (!r.ok) return alert(j.error || "Could not start the Reel.");
      setReelJob(j.jobId);
    } catch (e) {
      alert(unreachable(e));
    }
  }

  async function post() {
    const what = plan.map((p) => (p.kind === "carousel" ? `a photo post (${p.files.length} photos)` : p.kind === "image" ? "a photo post" : `the ${KIND_LABEL[p.kind]}`)).join(" and ");
    if (!window.confirm(`Post ${what} to Instagram now?\n\nIt goes live straight away.`)) return;
    try {
      const r = await fetch(`/api/instagram/kits/${slug}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, confirm: true }) });
      const j = await r.json();
      if (!r.ok) return alert([j.error, ...(j.problems ?? [])].filter(Boolean).join("\n"));
      setPubJob(j.jobId);
    } catch (e) {
      // Posting runs on the server as a job: reloading shows whether it started, so it is never sent twice by mistake.
      alert(`${unreachable(e)} Reload the page to see whether posting started before trying again.`);
    }
  }

  return (
    <div>
      <Steps at={results.some((r) => r.status === "published") ? 2 : 1} />
      <h1>{kit.title}</h1>

      {kit.log.length > 0 && (
        <div className="notice">
          Already on Instagram:{" "}
          {kit.log.map((e, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {KIND_LABEL[e.kind] ?? e.kind}{" "}
              {e.status === "published" ? (e.permalink ? <a href={e.permalink} target="_blank" rel="noreferrer">open</a> : "posted") : <b className="error">check Instagram</b>}
            </span>
          ))}
        </div>
      )}

      <div className="ig-layout">
        {/* ---- Phone preview ---- */}
        <div>
          <div className="ig-tabs">
            {(["feed", "story", "reel"] as const).map((t) => (
              <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{LABEL[t]}</button>
            ))}
          </div>
          <div className="ig-phone">
            {tab === "feed" && (
              <div className="ig-feed">
                <div className="ig-head"><span className="ig-avatar">EFJ</span><b>Elegant Fashion Jewellery</b>{slides[cur] && isAi(slides[cur]) && <span className="ig-ai-chip" style={{ marginLeft: "auto" }}>AI-generated</span>}</div>
                {slides.length ? (
                  <div className="ig-carousel" onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
                    {slides.map((s) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={s} src={file(s)} alt={draft.alts[s] ?? ""} />
                    ))}
                  </div>
                ) : <div className="ig-empty muted">No photos picked</div>}
                {slides.length > 1 && <div className="ig-dots">{slides.map((s, i) => <span key={s} className={i === cur ? "on" : ""} />)}</div>}
                <div className="ig-actions">♡ &nbsp;💬 &nbsp;➤<span style={{ marginLeft: "auto" }}>🔖</span></div>
                <div className="ig-caption">
                  <b>elegantfashionjewellery</b>{" "}
                  {(more ? caption : short).split(/(#[\p{L}\p{N}_]+)/u).map((part, i) => (part.startsWith("#") ? <span key={i} className="ig-tag">{part}</span> : part))}
                  {!more && lines.length > 2 && <button className="ig-more" onClick={() => setMore(true)}>… more</button>}
                </div>
              </div>
            )}
            {tab === "story" && (
              story ? (
                <div className="ig-story">
                  <div className="ig-story-bar"><span /></div>
                  <div className="ig-story-head"><span className="ig-avatar">EFJ</span> elegantfashionjewellery</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file(story)} alt="Story" />
                </div>
              ) : <div className="ig-empty muted">This kit has no Story image.</div>
            )}
            {tab === "reel" && (
              kit.files.reel ? (
                <div className="ig-reel">
                  <video key={reelStamp} src={`/api/instagram/kits/${slug}/file/${kit.files.reel}?v=${reelStamp}`} controls playsInline loop />
                  <div className="ig-reel-cap">{short}</div>
                </div>
              ) : <div className="ig-empty muted">No Reel yet. Press 🎬 Create Reel below.</div>
            )}
          </div>
          {tab === "reel" && !draft.marked && (
            <div className="card pad" style={{ marginTop: ".8rem" }}>
              <div className="row" style={{ alignItems: "center" }}>
                <button className="btn" onClick={createReel} disabled={busy || !status.ffmpeg || (!status.tracks.length && !draft.mute)}>
                  {kit.reels.items.length ? "🎬 Make a different one" : "🎬 Create Reel"}
                </button>
                <label className="chip" title="A Reel without music. You can add Instagram's own music in the app instead.">
                  <input type="checkbox" checked={draft.mute} onChange={(e) => set({ mute: e.target.checked })} /> Mute (no music)
                </label>
              </div>
              <p className="muted" style={{ fontSize: ".8rem", margin: ".4rem 0 0" }}>
                Each press picks a different style{status.tracks.length > 1 && !draft.mute ? " and a different track" : ""}: slow zoom, quick cuts, slide and push, close-up reveal, or pan with a price card{priceCard(draft.fields) ? "" : " (the card needs a price)"}.
              </p>
              {!status.ffmpeg && <p className="notice">ffmpeg is needed for Reels: <code>winget install Gyan.FFmpeg</code>, then reload.</p>}
              {status.ffmpeg && !status.tracks.length && !draft.mute && <p className="notice">There&apos;s no music in <code>{status.audioDir}</code> yet. Add an MP3, or tick Mute.</p>}
              {lastReel && (
                <p style={{ margin: ".5rem 0 0" }}><b>Style:</b> {recipeLabel(lastReel.recipe)} · <b>Track:</b> {lastReel.track ? lastReel.track.replace(/\.[a-z0-9]+$/i, "") : "none (muted)"}</p>
              )}
              {kit.reels.items.length > 1 && (
                <div className="ig-reels">
                  {[...kit.reels.items].reverse().map((r) => (
                    <div key={r.file} className={`ig-reel-pick ${kit.reels.chosen === r.file ? "on" : ""}`}>
                      <video src={reelFile(r.file)} muted playsInline loop preload="metadata" controls />
                      <span>{recipeLabel(r.recipe)}</span>
                      {kit.reels.chosen === r.file ? <b className="ig-ok-text">Will be posted</b> : <button className="btn ghost" onClick={() => chooseReel(r.file)} disabled={busy}>Use this one</button>}
                    </div>
                  ))}
                </div>
              )}
              {reelRun && reelRun.state !== "done" && <JobLog job={reelRun} title="Reel" />}
              <MusicHelp />
            </div>
          )}
        </div>

        {/* ---- The few things to check ---- */}
        <div>
          {!draft.marked && (
            <div className="card pad">
              <h2 style={{ marginBottom: ".5rem" }}>Photos</h2>
              {looks.length > 1 && (
                <div className="ig-compare">
                  {looks.map(([id, label, cover]) => (
                    <button key={id} className={`ig-look ${draft.look === id ? "on" : ""}`} onClick={() => setLook(id)} disabled={busy} title={label}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={file(cover)} alt="" />
                      <span>{label}{id === "ai" && <> <span className="ig-ai-chip">AI</span></>}</span>
                    </button>
                  ))}
                </div>
              )}
              {claudeNote && <p className="muted" style={{ fontSize: ".8rem", margin: ".2rem 0 .5rem" }}>{claudeNote}</p>}
              {kit.canRegenerate && !kit.files.claude.length && kit.claudeStyle?.status !== "skipped" && status.claude && (
                <button className="btn ghost" onClick={() => regenerate(true)} disabled={busy} style={{ marginBottom: ".5rem" }}>✦ Ask Claude for a styled version</button>
              )}
              {draft.look === "claude" && kit.canRegenerate && (
                <div className="row">
                  <button className="btn ghost" onClick={() => regenerate(true)} disabled={busy}>{regenRun?.state === "running" ? "Asking…" : "↻ Ask Claude again"}</button>
                  {kit.hasPrevious && <button className="btn ghost" onClick={previous} disabled={busy}>↩ Previous version</button>}
                </div>
              )}
              {draft.look === "studio" && kit.canRegenerate && (
                <div className="row">
                  <select aria-label="Backdrop" value={backdrop} onChange={(e) => setBackdrop(e.target.value)} style={{ flex: "1 1 10rem", width: "auto" }} disabled={busy}>
                    {BACKDROPS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <button className="btn ghost" onClick={() => regenerate(false)} disabled={busy}>{regenRun?.state === "running" ? "Making…" : "↻ New backdrop"}</button>
                  {kit.hasPrevious && <button className="btn ghost" onClick={previous} disabled={busy}>↩ Previous version</button>}
                  <label className="chip" style={{ flexBasis: "100%" }} title="For photos taken on a black velvet bust or pad. Not for pieces with black stones or enamel.">
                    <input type="checkbox" checked={dropDark} onChange={(e) => setDropDark(e.target.checked)} /> Remove black velvet display
                  </label>
                </div>
              )}
              {draft.look === "original" && <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>Your own photos, framed to fit. Nothing else is changed.</p>}
              {draft.look === "ai" && <p className="ig-ai-warn">AI scenes can differ slightly from the real piece. Check it matches before posting, and say so in the caption if you like.</p>}
              {kit.aiScenes.length > 0 && (
                <ul className="ig-ai-list">
                  {kit.aiScenes.map((a) => (
                    <li key={a.file}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={file(a.file)} alt="" />
                      <div>
                        <span className="ig-ai-chip">AI-generated</span>{" "}
                        <b className={a.low ? "error" : "ig-ok-text"}>{a.score}% match</b>
                        {a.low && <div className="error" style={{ fontSize: ".8rem" }}>Doesn&apos;t match your piece closely: not recommended.</div>}
                        <div className="muted" style={{ fontSize: ".75rem" }}>{a.notes}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="ig-ai-gen">
                {status.gemini ? (
                  <>
                    <div className="row">
                      <select aria-label="How many AI scenes" value={aiCount} onChange={(e) => setAiCount(Number(e.target.value) === 2 ? 2 : 1)} disabled={busy} style={{ width: "auto" }}>
                        <option value={1}>1 image</option>
                        <option value={2}>2 images</option>
                      </select>
                      <select aria-label="AI scene style" value={aiStyle} onChange={(e) => setAiStyle(e.target.value)} disabled={busy} style={{ flex: "1 1 8rem", width: "auto" }}>
                        {AI_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                      <button className="btn ghost" onClick={generateAi} disabled={busy}>{aiRun?.state === "running" ? "Generating…" : "✨ Generate AI scene (1 or 2 images)"}</button>
                    </div>
                    <p className="muted" style={{ fontSize: ".75rem", margin: ".3rem 0 0" }}>
                      Only when you press it. Uses your Gemini key: a small charge per image, about a minute each. Each picture is checked against your piece; any with text or a logo is thrown away. Your current photos stay selected.
                    </p>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>AI scenes need a Gemini API key in Settings.</p>
                )}
              </div>
              {aiRun && aiRun.state !== "done" && <JobLog job={aiRun} title="AI scene" />}
              {aiRun?.state === "done" && ((aiRun.result as { dropped?: string[] } | undefined)?.dropped ?? []).map((d) => <p key={d} className="muted" style={{ fontSize: ".8rem" }}>{d}</p>)}
              {regenRun && regenRun.state !== "done" && <JobLog job={regenRun} title="Making the images again" />}
            </div>
          )}

          <div className="card pad">
            {draft.marked ? (
              <p className="error">Skipped: this piece can&apos;t be posted from here.</p>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Caption</h2>
                  <button className="btn ghost" onClick={rewrite} disabled={busy}>{rewriting ? "Writing…" : "↻ Rewrite"}</button>
                </div>
                {draft.aiNote && <p className="muted" style={{ fontSize: ".8rem", margin: ".3rem 0" }}>{draft.aiNote}</p>}
                <textarea rows={7} value={draft.caption} onChange={(e) => set({ caption: e.target.value })} aria-label="Caption" />
                <label htmlFor="ig-tags" style={{ marginTop: ".6rem" }}>Hashtags</label>
                <textarea id="ig-tags" rows={3} value={draft.hashtags} onChange={(e) => set({ hashtags: e.target.value })} />
                <div className="row" style={{ marginTop: ".6rem" }}>
                  <div style={{ flex: "0 0 9rem" }}>
                    <label htmlFor="ig-price">Price (CAD)</label>
                    <input id="ig-price" value={draft.fields.price} onChange={(e) => setFields({ price: e.target.value })} placeholder="35" inputMode="decimal" />
                  </div>
                  <div style={{ flex: "1 1 8rem" }}>
                    <label htmlFor="ig-cat">Piece</label>
                    <select id="ig-cat" value={draft.category} onChange={(e) => set({ category: e.target.value as Draft["category"] })}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 8rem" }}>
                    <label htmlFor="ig-tone">Colour</label>
                    <select id="ig-tone" value={draft.tone} onChange={(e) => set({ tone: e.target.value as Draft["tone"] })}>
                      <option value="gold">gold-tone (10K gold-plated)</option>
                      <option value="silver">silver-tone</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div className="ig-post-what">
              {(["feed", "story", "reel"] as const).map((g) => (
                <label key={g} className={`chip ${draft[g] ? "on" : ""}`} title={posted.includes(g) ? "Already posted" : ""}>
                  <input type="checkbox" checked={draft[g]} onChange={(e) => set({ [g]: e.target.checked } as Partial<Draft>)} />
                  {LABEL[g]}{posted.includes(g) && " (posted)"}
                </label>
              ))}
            </div>

            {problems.length > 0 && <ul className="ig-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {!status.instagram && <p className="error">The Instagram token isn&apos;t set up, so posting is off.</p>}
            <button className="btn ig-post-btn" disabled={problems.length > 0 || busy || !status.instagram} onClick={post}>
              Post to Instagram
            </button>
            {pubRun && <JobLog job={pubRun} title="Posting" />}
            {results.length > 0 && (
              <ul>
                {results.map((r, i) => (
                  <li key={i}>
                    {KIND_LABEL[r.kind] ?? r.kind}:{" "}
                    {r.status === "published"
                      ? r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer">{r.permalink}</a> : "posted"
                      : <b className="error">no clear answer: check Instagram before trying again</b>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Recommendations rec={kit.recommendations} draft={draft} set={set} setFields={setFields} />

          <details className="card pad ig-more-opts">
            <summary>More options</summary>

            <div className="fields" style={{ marginTop: ".8rem" }}>
              <div>
                <label htmlFor="ig-order">How to order (fills [ORDER CTA])</label>
                <input id="ig-order" value={draft.fields.order} onChange={(e) => setFields({ order: e.target.value })} placeholder="Comment ✨ and we'll DM you the details." />
              </div>
              <div>
                <label htmlFor="ig-length">Chain length (fills [CHAIN LENGTH])</label>
                <input id="ig-length" value={draft.fields.length} onChange={(e) => setFields({ length: e.target.value })} placeholder="18 inches" />
              </div>
            </div>

            {draft.captions.length > 1 && (
              <>
                <h3 style={{ marginTop: "1rem" }}>Other captions</h3>
                <div className="chips">
                  {draft.captions.map((c, i) => (
                    <button key={i} className={`chip ${draft.caption === c ? "on" : ""}`} onClick={() => set({ caption: c })} title={c}>
                      {c.split("\n")[0].slice(0, 40)}
                    </button>
                  ))}
                </div>
              </>
            )}

            <h3 style={{ marginTop: "1rem" }}>Photos and alt text</h3>
            {candidates.map((n) => {
              const i = draft.slides.indexOf(n);
              return (
                <div key={n} className="ig-slide-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file(n)} alt="" />
                  <div style={{ flex: 1 }}>
                    <div className="row">
                      <label className={`chip ${i >= 0 ? "on" : ""}`}>
                        <input type="checkbox" checked={i >= 0} onChange={() => toggleSlide(n)} />
                        {i >= 0 ? `Slide ${i + 1}` : "Not in the post"}
                      </label>
                      {isAi(n) ? <span className="ig-ai-chip">AI-generated{aiMeta.get(n) ? ` · ${aiMeta.get(n)!.score}%` : ""}</span> : <span className="muted" style={{ fontSize: ".8rem" }}>{/original/.test(n) ? "your photo" : /closeup/.test(n) ? "close-up" : /1x1/.test(n) ? "square" : "studio"}</span>}
                      {i >= 0 && <><button className="btn ghost" onClick={() => move(n, -1)} aria-label="Move up">↑</button><button className="btn ghost" onClick={() => move(n, 1)} aria-label="Move down">↓</button></>}
                    </div>
                    {i >= 0 && (
                      <textarea rows={2} placeholder="Alt text: what the photo shows" value={draft.alts[n] ?? ""} onChange={(e) => set({ alts: { ...draft.alts, [n]: e.target.value } })} aria-label={`Alt text for slide ${i + 1}`} />
                    )}
                  </div>
                </div>
              );
            })}

            <h3 style={{ marginTop: "1rem" }}>Reel with music</h3>
            <p className="muted" style={{ fontSize: ".85rem" }}>
              A short video of the photos with your own track. Instagram&apos;s music library can&apos;t be added from here, so use only music you have the rights to.
            </p>
            {!status.ffmpeg ? (
              <p className="notice">ffmpeg is needed for Reels: <code>winget install Gyan.FFmpeg</code>, then reload.</p>
            ) : !status.tracks.length ? (
              <p className="notice">Put MP3s in <code>{status.audioDir}</code>, then reload.</p>
            ) : (
              <>
                <select aria-label="Track" value={draft.track} onChange={(e) => set({ track: e.target.value })}>
                  <option value="">Pick a track…</option>
                  {status.tracks.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {draft.track && <audio controls src={`/api/instagram/audio/${encodeURIComponent(draft.track)}`} style={{ width: "100%", marginTop: ".5rem" }} />}
                <div className="row" style={{ marginTop: ".6rem" }}>
                  <button className="btn ghost" disabled={!draft.track || busy} onClick={buildReel}>{kit.files.reel ? "Make the Reel again" : "Make the Reel"}</button>
                </div>
              </>
            )}
            {reelRun && <JobLog job={reelRun} title="Reel" />}
          </details>
        </div>
      </div>
    </div>
  );
}
