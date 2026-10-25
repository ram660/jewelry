"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CATEGORIES, GENDERS, STATUSES, imageUrl, type Product, type ProductImage } from "@/lib/types";
import { checkProduct } from "@/lib/claims";

type Movement = { delta: number; reason: string; at: string };

const csv = (a: string[]) => a.join(", ");
const unCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const IG_CAP = 2200;

export default function ProductEditor({
  initial, images, movements, demoMode, nameSuggestions, topSlot,
}: {
  initial: Product; images: ProductImage[]; movements: Movement[]; demoMode: boolean; nameSuggestions?: string[];
  /** Sections shown above the details: the rendered images and the Gemini prompt. */
  topSlot?: ReactNode;
}) {
  const router = useRouter();
  const [markInput, setMarkInput] = useState("");
  const [showMarks, setShowMarks] = useState(false);
  const [p, setP] = useState<Product>(initial);
  const [saved, setSaved] = useState<Product>(initial);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [stockDelta, setStockDelta] = useState("");
  const [stockReason, setStockReason] = useState<"restock" | "sale" | "damaged">("restock");
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = useMemo(() => JSON.stringify(p) !== JSON.stringify(saved), [p, saved]);
  const approvedCount = images.filter((i) => i.approved).length;
  const checks = useMemo(() => checkProduct(p, approvedCount), [p, approvedCount]);
  const blockers = checks.filter((c) => c.level === "block");
  const warnings = checks.filter((c) => c.level === "warn");

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const num = (s: string) => (s === "" ? null : Number(s));
  const adopt = (np: Product) => { setP(np); setSaved(np); };

  const margin =
    p.price_cad && p.cost_cad != null && p.price_cad > 0
      ? Math.round(((p.price_cad - p.cost_cad) / p.price_cad) * 100)
      : null;

  function flash(ok: string) { setErr(""); setProblems([]); setMsg(ok); }

  async function save() {
    setBusy("Saving…"); setErr(""); setMsg(""); setProblems([]);
    const res = await fetch(`/api/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    setBusy("");
    if (res.status === 422) {
      const j = await res.json();
      setErr(j.error);
      setProblems(j.problems ?? []);
      return;
    }
    if (!res.ok) return setErr((await res.json().catch(() => null))?.error || "Could not save.");
    adopt(await res.json());
    flash("Saved ✓");
    router.refresh();
  }

  async function analyse() {
    if (dirty && !confirm("You have unsaved edits. The AI will refresh the saved version. Continue?")) return;
    if (p.analysed_at && !confirm("Re-run the AI? This replaces the descriptions, captions and tags (your price, stock and facts are kept).")) return;
    setBusy("AI is working…"); setErr(""); setMsg(""); setProblems([]);
    const res = await fetch(`/api/products/${p.id}/analyze`, { method: "POST" });
    const j = await res.json();
    setBusy("");
    if (!res.ok) return setErr(j.error || "AI analysis failed");
    adopt(j.product);
    flash(
      j.demoted ? "AI text updated, but it broke a rule, so the status went back to Draft."
        : j.demo ? "Demo text filled in (no AI key active yet)."
        : "AI analysis updated ✓"
    );
    router.refresh();
  }

  async function stock(delta: number, reason: string) {
    const res = await fetch(`/api/products/${p.id}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta, reason }),
    });
    if (!res.ok) return;
    const { stock_qty } = (await res.json()) as Product;
    set("stock_qty", stock_qty); // stock is saved by this call, so it is not an unsaved edit
    setSaved((s) => ({ ...s, stock_qty }));
    router.refresh();
  }

  async function applyStockDelta() {
    const n = parseInt(stockDelta, 10);
    if (!stockDelta || isNaN(n) || n === 0) return;
    await stock(n, stockReason);
    setStockDelta("");
  }

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Uploading photos…"); setErr("");
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f));
    const res = await fetch(`/api/products/${p.id}/images`, { method: "POST", body: fd });
    setBusy("");
    if (!res.ok) return setErr((await res.json()).error || "Upload failed");
    flash("Photos added ✓");
    router.refresh();
  }

  async function removeImage(id: number) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/images/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function makePrimary(id: number) {
    await fetch(`/api/images/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primary: true }),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${p.name || p.sku}" and all its photos? This cannot be undone.`)) return;
    await fetch(`/api/products/${p.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); flash("Copied ✓"); } catch { setErr("Copy failed"); }
  };

  const originals = images.filter((i) => i.kind === "original");
  const generated = images.length - originals.length;

  return (
    <>
      <div className="toolbar">
        <h1 className="grow">{p.name || "(unnamed)"} <span className="muted" style={{ fontSize: "1rem" }}>{p.sku}</span></h1>
        <Link href={`/products/${p.id}/studio`} className="btn ghost">🎨 More studio tools{generated ? ` (${generated})` : ""}</Link>
        <button className="btn ghost" onClick={analyse} disabled={!!busy} title="Sends your photos to the AI and fills in the description, captions and tags">
          {p.analysed_at ? "↻ Re-write with AI" : "✨ Write description with AI"}
        </button>
        <button className="btn" onClick={save} disabled={!!busy || !dirty}>{dirty ? "Save changes" : "Saved"}</button>
      </div>
      {demoMode && (
        <div className="notice">
          Demo mode: no AI key is active (see Settings), so AI output is placeholder text.
        </div>
      )}
      {dirty && <p className="muted">You have unsaved changes.</p>}
      {busy && <p className="muted">{busy}</p>}
      {msg && <p style={{ color: "var(--ok)" }}>{msg}</p>}
      {err && <p className="error">{err}</p>}
      {problems.length > 0 && <ul className="error">{problems.map((x, i) => <li key={i}>{x}</li>)}</ul>}

      {topSlot}

      <div className="split">
        <div>
          <div className="thumbs" style={{ marginTop: 0 }}>
            {originals.map((im, idx) => (
              <div className="t" key={im.id} style={{ width: 140 }}>
                <a href={imageUrl(im.path)} target="_blank" rel="noreferrer">
                  <img src={imageUrl(im.thumb_path)} alt="" style={{ width: 140, height: 140 }} />
                </a>
                <button onClick={() => removeImage(im.id)} aria-label="Delete photo">×</button>
                {idx === 0
                  ? <span className="badge ok" style={{ marginTop: 4 }}>★ primary</span>
                  : <button className="btn small ghost" style={{ position: "static", width: "auto", height: "auto", borderRadius: 8, marginTop: 4, background: "transparent", color: "var(--gold)" }} onClick={() => makePrimary(im.id)}>Make primary</button>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            <button className="btn small ghost" onClick={() => fileInput.current?.click()} disabled={!!busy}>+ Add photos</button>
          </div>

          <div className="card pad" style={{ marginTop: "1rem" }}>
            <h2>Ready to post?</h2>
            {blockers.length === 0
              ? <p style={{ color: "var(--ok)", margin: 0 }}>✓ Passes all required checks.</p>
              : <ul className="q error">{blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>}
            {warnings.length > 0 && (
              <ul className="q muted">{warnings.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
            )}
            <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>
              Required checks must pass before the status can be Ready, Scheduled or Posted.
            </p>
          </div>

          <div className="card pad">
            <h2>Stock: {p.stock_qty}</h2>
            {p.stock_qty <= p.low_stock_at && p.stock_qty > 0 && (
              <p className="muted" style={{ margin: "0 0 .5rem", fontSize: ".85rem" }}>
                ⚠ Low stock threshold reached ({p.low_stock_at}).
              </p>
            )}
            <div className="row" style={{ marginBottom: ".5rem" }}>
              <input
                type="number"
                placeholder="Qty"
                value={stockDelta}
                onChange={(e) => setStockDelta(e.target.value)}
                style={{ width: 70 }}
                onKeyDown={(e) => e.key === "Enter" && applyStockDelta()}
              />
              <select value={stockReason} onChange={(e) => setStockReason(e.target.value as typeof stockReason)} style={{ width: "auto" }}>
                <option value="restock">Restock (+)</option>
                <option value="sale">Sale (−)</option>
                <option value="damaged">Damaged (−)</option>
              </select>
              <button className="btn small ghost" onClick={applyStockDelta} disabled={!stockDelta}>Apply</button>
            </div>
            <div className="row" style={{ gap: ".4rem" }}>
              <button className="btn small ghost" onClick={() => stock(1, "restock")}>+1</button>
              <button className="btn small ghost" onClick={() => stock(5, "restock")}>+5</button>
              <button className="btn small ghost" onClick={() => stock(-1, "sale")}>−1 sold</button>
              <button className="btn small ghost" onClick={() => stock(-1, "damaged")}>−1 damaged</button>
            </div>
            {movements.length > 0 && (
              <ul className="muted" style={{ paddingLeft: "1.1rem", fontSize: ".85rem" }}>
                {movements.slice(0, 6).map((m, i) => (
                  <li key={i}>{m.delta > 0 ? "+" : ""}{m.delta} {m.reason} · {m.at}</li>
                ))}
              </ul>
            )}
          </div>

          <button className="btn danger small" onClick={remove}>Delete product</button>
        </div>

        <div>
          {p.owner_questions.length > 0 && (
            <div className="notice">
              <b>The AI can't tell these from a photo. Please fill them in:</b>
              <ul className="q">{p.owner_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}

          <div className="card pad">
            <h2>Basics</h2>
            {nameSuggestions && nameSuggestions.length > 0 && (
              <div style={{ marginBottom: ".6rem" }}>
                <p className="muted" style={{ margin: "0 0 .4rem", fontSize: ".82rem" }}>AI name suggestions — click to use:</p>
                <div className="chips">
                  {nameSuggestions.map((s, i) => (
                    <button key={i} className={`chip ${p.name === s ? "on" : ""}`} onClick={() => set("name", s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="fields">
              <div className="wide"><label>Name</label><input value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div><label>Category</label>
                <select value={p.category} onChange={(e) => set("category", e.target.value as Product["category"])}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></div>
              <div><label>Style (subcategory)</label><input value={p.subcategory} onChange={(e) => set("subcategory", e.target.value)} /></div>
              <div><label>For</label>
                <select value={p.gender} onChange={(e) => set("gender", e.target.value)}>
                  {GENDERS.map((g) => <option key={g}>{g}</option>)}
                </select></div>
              <div><label>Status</label>
                <select value={p.status} onChange={(e) => set("status", e.target.value as Product["status"])}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select></div>
              <div><label>Colour / finish</label><input value={p.colour_finish} onChange={(e) => set("colour_finish", e.target.value)} /></div>
              <div><label>Stones</label><input value={p.stones} onChange={(e) => set("stones", e.target.value)} /></div>
            </div>
          </div>

          {(p.marks_seen.length > 0 || showMarks) ? (
            <div className="card pad">
              <h2>Brand marks on this piece</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: ".85rem" }}>
                Names, logos and engraved text that are on the piece, written exactly as they appear. Your photos and rendered
                images never change them. The AI also fills this in when you press the AI button.
              </p>
              <div className="chips" style={{ marginBottom: ".5rem" }}>
                {p.marks_seen.map((m, i) => (
                  <span key={i} className="chip on">
                    {m}
                    <button type="button" aria-label={`Remove ${m}`} style={{ border: 0, background: "transparent", cursor: "pointer" }}
                      onClick={() => set("marks_seen", p.marks_seen.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
                {p.marks_seen.length === 0 && <span className="muted">None recorded.</span>}
              </div>
              <div className="row">
                <input value={markInput} maxLength={160} placeholder="Type a mark exactly as it appears, then press Add"
                  style={{ flex: 1, minWidth: 220 }}
                  onChange={(e) => setMarkInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && markInput.trim()) { e.preventDefault(); set("marks_seen", [...p.marks_seen, markInput.trim()]); setMarkInput(""); } }} />
                <button type="button" className="btn small ghost" disabled={!markInput.trim()}
                  onClick={() => { set("marks_seen", [...p.marks_seen, markInput.trim()]); setMarkInput(""); }}>Add</button>
              </div>
              {p.marks_seen.length > 0 && (
                <div style={{ marginTop: ".7rem" }}>
                  <label>Is this piece genuine?</label>
                  <select value={p.authenticity} onChange={(e) => set("authenticity", e.target.value as Product["authenticity"])}>
                    <option value="">Not answered yet</option>
                    <option value="genuine">Yes, it is genuine and I have proof (receipt or certificate)</option>
                    <option value="not_genuine">No, it is not made by that brand</option>
                  </select>
                  <p className="muted" style={{ fontSize: ".82rem", marginBottom: 0 }}>
                    {p.authenticity === "not_genuine"
                      ? "A piece with another brand's mark that is not genuine cannot be posted. Rendering and downloading your pictures still work."
                      : p.authenticity === "genuine"
                      ? "Keep the proof. Describe the metal and plating exactly as they are, since they may differ from your usual pieces."
                      : "Posting stays blocked until this is answered."}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="btn small ghost" style={{ marginBottom: "1rem" }} onClick={() => setShowMarks(true)}>
              + This piece shows a brand name or logo
            </button>
          )}

          <div className="card pad">
            <h2>Price &amp; facts</h2>
            <div className="fields">
              <div><label>Price (CAD)</label><input type="number" step="0.01" value={p.price_cad ?? ""} onChange={(e) => set("price_cad", num(e.target.value))} /></div>
              <div><label>Compare-at price (CAD)</label><input type="number" step="0.01" value={p.compare_at_cad ?? ""} onChange={(e) => set("compare_at_cad", num(e.target.value))} placeholder="Optional: the regular price you really charged" /></div>
              <div><label>Your cost (CAD)</label><input type="number" step="0.01" value={p.cost_cad ?? ""} onChange={(e) => set("cost_cad", num(e.target.value))} /></div>
              <div><label>Margin</label><input readOnly value={margin == null ? "-" : `${margin}%`} /></div>
              <div><label>Stock quantity</label><input type="number" min={0} value={p.stock_qty} onChange={(e) => set("stock_qty", Number(e.target.value))} /></div>
              <div><label>Low-stock alert at</label><input type="number" min={0} value={p.low_stock_at} onChange={(e) => set("low_stock_at", Math.max(0, Number(e.target.value)))} placeholder="e.g. 3" /></div>
              <div><label>Plating</label><input value={p.plating} onChange={(e) => set("plating", e.target.value)} /></div>
              <div><label>Base metal</label><input value={p.base_metal} onChange={(e) => set("base_metal", e.target.value)} placeholder="brass, stainless steel…" /></div>
              <div><label>Plating thickness</label><input value={p.plating_microns} onChange={(e) => set("plating_microns", e.target.value)} placeholder="e.g. 1 µm" /></div>
              <div><label>Nickel-free?</label>
                <select
                  value={p.nickel_free == null ? "" : p.nickel_free ? "yes" : "no"}
                  onChange={(e) => set("nickel_free", e.target.value === "" ? null : e.target.value === "yes")}
                >
                  <option value="">Unknown</option><option value="yes">Yes (certified)</option><option value="no">No</option>
                </select></div>
              <div><label>Hypoallergenic?</label>
                <select
                  value={p.hypoallergenic == null ? "" : p.hypoallergenic ? "yes" : "no"}
                  onChange={(e) => set("hypoallergenic", e.target.value === "" ? null : e.target.value === "yes")}
                >
                  <option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
                </select></div>
              <div><label>Anti-tarnish?</label>
                <select
                  value={p.anti_tarnish == null ? "" : p.anti_tarnish ? "yes" : "no"}
                  onChange={(e) => set("anti_tarnish", e.target.value === "" ? null : e.target.value === "yes")}
                >
                  <option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
                </select></div>
              <div><label>Sizes / lengths</label><input value={p.sizes} onChange={(e) => set("sizes", e.target.value)} placeholder="6, 7, 8 / 16″ + 2″ extender" /></div>
              <div><label>Weight (g)</label><input type="number" step="0.1" value={p.weight_g ?? ""} onChange={(e) => set("weight_g", num(e.target.value))} /></div>
            </div>
          </div>

          <div className="card pad">
            <h2>Descriptions</h2>
            <div className="fields">
              <div className="wide"><label>Short description</label><input value={p.short_desc} onChange={(e) => set("short_desc", e.target.value)} /></div>
              <div className="wide"><label>Full description</label><textarea value={p.long_desc} onChange={(e) => set("long_desc", e.target.value)} /></div>
              <div className="wide"><label>Care notes</label><textarea value={p.care_notes} onChange={(e) => set("care_notes", e.target.value)} /></div>
              <div className="wide"><label>Image alt text</label><input value={p.alt_text} onChange={(e) => set("alt_text", e.target.value)} /></div>
              <div className="wide"><label>Style tags (comma separated)</label><input value={csv(p.style_tags)} onChange={(e) => set("style_tags", unCsv(e.target.value))} /></div>
              <div className="wide"><label>Occasion tags</label><input value={csv(p.occasion_tags)} onChange={(e) => set("occasion_tags", unCsv(e.target.value))} /></div>
            </div>
          </div>

          <div className="card pad">
            <h2>Instagram captions</h2>
            {p.captions.length === 0 && <p className="muted">Run the AI analysis to get 3 caption options.</p>}
            {p.captions.map((c, i) => (
              <div className="cap" key={i}>
                <textarea
                  value={c}
                  onChange={(e) => set("captions", p.captions.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <div className="row" style={{ marginTop: ".4rem", justifyContent: "space-between" }}>
                  <button className="btn small ghost" onClick={() => copy(`${c}\n.\n${csv(p.hashtags).replaceAll(",", "")}`)}>
                    Copy with hashtags
                  </button>
                  <span style={{ fontSize: ".78rem", color: c.length > IG_CAP ? "var(--danger)" : c.length > IG_CAP * 0.9 ? "#92600a" : "var(--muted)" }}>
                    {c.length.toLocaleString()} / {IG_CAP.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
            <label>Hashtags</label>
            <input value={csv(p.hashtags)} onChange={(e) => set("hashtags", unCsv(e.target.value))} />
          </div>
        </div>
      </div>
    </>
  );
}
