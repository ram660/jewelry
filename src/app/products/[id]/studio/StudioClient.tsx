"use client";

import { useState } from "react";
import { KIND_LABEL, MAX_CAROUSEL, imageUrl, type Product, type ProductImage } from "@/lib/types";
import { SCALE_PRESET, SCENES, SKIN_TONES, posesFor } from "@/lib/presets";
import PosterMaker from "./PosterMaker";
import { FORMATS, type FormatId } from "@/lib/posters";
import { LOOKS, LOOK_IDS, type LookId } from "@/lib/looks";
import { checklistFor } from "@/lib/reviewChecklist";

type Job = { label: string; body: Record<string, unknown> };
type LogLine = { ok: boolean; text: string };

// Recommended slide order: a poster as the cover, then scene, on-model, real photo, close-ups, scale, info card.
const KIND_RANK: Record<string, number> = {
  poster: -2, studio: -1, scene: 0, on_model: 1, clean: 2, enhanced: 3, original: 4, scale: 5, price_card: 6,
};
const isStory = (img: ProductImage) => (img.kind === "poster" || img.kind === "studio") && /Story/.test(img.label ?? "");

export default function StudioClient({
  product, initialImages, realOnly, scoring, safeAvailable, model, fidelityMin,
}: {
  product: Product; initialImages: ProductImage[]; realOnly: boolean; scoring: boolean; safeAvailable: boolean;
  model: string; fidelityMin: number;
}) {
  const [images, setImages] = useState<ProductImage[]>(initialImages);
  // Safe mode (your real product pixels, only the backdrop is made) is the default: the jewellery must never change.
  // With no AI picture provider (realOnly) it is the only mode, and the backdrop is drawn by code.
  const [safeMode, setSafeMode] = useState(true);
  const useSafe = realOnly || (safeMode && safeAvailable);
  const [selScenes, setSelScenes] = useState<string[]>([]);
  const [selPoses, setSelPoses] = useState<string[]>([]);
  const [skin, setSkin] = useState<string>("medium");
  const [running, setRunning] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [note, setNote] = useState("");
  const [studioLooks, setStudioLooks] = useState<LookId[]>([...LOOK_IDS]);
  const [studioFormat, setStudioFormat] = useState<FormatId | "all">("post");
  const [studioPhotos, setStudioPhotos] = useState<"primary" | "all">("primary");
  const [studioLogo, setStudioLogo] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const poses = posesFor(product.category, product.gender);
  const originals = images.filter((i) => i.kind === "original");
  // Transparent cut-outs are design assets (posters, Canva): they have their own strip, not the review queue.
  const cutouts = images.filter((i) => i.kind === "cutout");
  const review = images.filter((i) => !i.approved && i.kind !== "cutout");
  const library = images.filter((i) => i.approved && i.kind !== "cutout");
  const carousel = images
    .filter((i) => i.approved && i.carousel_pos != null)
    .sort((a, b) => (a.carousel_pos ?? 0) - (b.carousel_pos ?? 0));

  async function reload() {
    const r = await fetch(`/api/products/${product.id}/images`);
    if (r.ok) setImages(await r.json());
  }

  async function runJobs(jobs: Job[]) {
    setLog([]); setNote("");
    for (const [i, job] of jobs.entries()) {
      setRunning(`Creating ${i + 1} of ${jobs.length}: ${job.label}…`);
      try {
        const r = await fetch(`/api/products/${product.id}/visuals`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body),
        });
        const j = await r.json();
        setLog((l) => [...l, { ok: r.ok, text: r.ok ? `✓ ${job.label}` : `✗ ${job.label}: ${j.error}` }]);
      } catch {
        setLog((l) => [...l, { ok: false, text: `✗ ${job.label}: network error` }]);
      }
      await reload();
    }
    setRunning("");
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function touchUp() {
    const done = new Set(images.filter((i) => i.kind === "enhanced").map((i) => i.source_image_id));
    const todo = originals.filter((o) => !done.has(o.id));
    if (!todo.length) return setNote("All photos are already touched up.");
    runJobs(todo.map((o, i) => ({ label: `Touch up photo ${i + 1}`, body: { kind: "enhance", sourceImageId: o.id } })));
  }

  function cleanAll() {
    const cleaned = new Set(images.filter((i) => i.kind === "clean").map((i) => i.source_image_id));
    const cut = new Set(images.filter((i) => i.kind === "cutout").map((i) => i.source_image_id));
    // A new clean-background job also saves the transparent cut-out; older photos may only need the cut-out.
    const jobs: Job[] = originals.flatMap((o, i): Job[] =>
      !cleaned.has(o.id) ? [{ label: `Remove background, photo ${i + 1}`, body: { kind: "clean", sourceImageId: o.id } }]
        : !cut.has(o.id) ? [{ label: `Transparent cut-out, photo ${i + 1}`, body: { kind: "cutout", sourceImageId: o.id } }]
        : []
    );
    if (!jobs.length) return setNote("All photos already have a clean background and a transparent cut-out.");
    runJobs(jobs);
  }

  function makeStudio() {
    const photos = studioPhotos === "all" ? originals : originals.slice(0, 1);
    const formats = studioFormat === "all" ? (Object.keys(FORMATS) as FormatId[]) : [studioFormat];
    const jobs: Job[] = photos.flatMap((o, i) => studioLooks.flatMap((look) => formats.map((format) => ({
      label: `${LOOKS[look].label} · ${FORMATS[format].label}${photos.length > 1 ? ` · photo ${i + 1}` : ""}`,
      body: { kind: "studio", sourceImageId: o.id, look, format, logo: studioLogo },
    }))));
    if (!jobs.length) return setNote("Pick at least one look.");
    runJobs(jobs);
  }

  async function patchImage(id: number, body: object) {
    await fetch(`/api/images/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await reload();
  }

  async function approve(img: ProductImage) {
    if (img.fidelity_score != null && img.fidelity_score < fidelityMin &&
        !confirm(`The match score is only ${img.fidelity_score}%. ${img.fidelity_notes ?? ""}\n\nCompare it with your real photo. Approve anyway?`)) return;
    await patchImage(img.id, { approved: true });
  }

  async function del(img: ProductImage) {
    if (!confirm("Delete this image?")) return;
    await fetch(`/api/images/${img.id}`, { method: "DELETE" });
    await reload();
  }

  async function putCarousel(ids: number[]) {
    setNote("");
    await fetch(`/api/products/${product.id}/carousel`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    });
    await reload();
  }

  function addToCarousel(img: ProductImage) {
    if (isStory(img)) return setNote("That poster is a 9:16 Story. Post it as a Story; carousels are 4:5.");
    if (carousel.length >= MAX_CAROUSEL) return setNote(`Instagram carousels hold at most ${MAX_CAROUSEL} slides.`);
    putCarousel([...carousel.map((c) => c.id), img.id]);
  }

  function move(idx: number, dir: -1 | 1) {
    const ids = carousel.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    putCarousel(ids);
  }

  function autoArrange() {
    const ranked = library.filter((i) => !isStory(i)).sort(
      (a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.sort_order - b.sort_order
    );
    putCarousel(ranked.slice(0, MAX_CAROUSEL).map((i) => i.id));
  }

  function dropSlide(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const ids = carousel.map((c) => c.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    putCarousel(ids);
  }

  return (
    <>
      <h1>Visual Studio <span className="muted" style={{ fontSize: "1rem" }}>{product.name || product.sku}</span></h1>

      {realOnly ? (
        <div className="notice">
          <b>Real photos only.</b> No AI makes any picture here. Your jewellery is cut out of your own photo (BiRefNet) and placed on a
          backdrop drawn by code, so the piece itself is never redrawn. On-model and scale shots need an AI picture model, so they are off.
        </div>
      ) : (
        <p className="muted">
          Image model: <code>{model}</code>.{" "}
          {scoring
            ? "Every generated image is compared with your real photos and given a match score."
            : "No match score is available because no vision provider is active."}
        </p>
      )}
      {originals.length === 0 && <p className="error">This product has no original photos yet. Add some on the product page.</p>}

      <div className="card pad">
        <h2>1 · Clean up your real photos</h2>
        <p className="muted">
          Starts from your own photo. Nothing is generated. These tools only cut the background away and adjust colour,
          contrast and sharpness. Shape and details stay as photographed, but check the colour and edges against the piece.
        </p>
        <div className="row">
          <button className="btn" disabled={!!running || !originals.length} onClick={cleanAll}>🧹 Remove background</button>
          <button className="btn ghost" disabled={!!running || !originals.length} onClick={touchUp}>✨ Touch up colour &amp; sharpness</button>
        </div>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 0 }}>
          <b>Remove background</b> makes two things from each photo: a version on a clean cream backdrop, and a
          <b> transparent cut-out</b> for posters (or to download for Canva). It finds <b>gold</b> pieces by colour, even
          in a busy room or on a display bust. <b>Silver, rose gold or stones</b> work when photographed on a plain
          backdrop that fills the frame: for silver use grey or black, because very light silver on a white card loses
          its brightest parts. Always zoom in and check the edges and the chain before approving.
        </p>

        {cutouts.length > 0 && (
          <>
            <h3 style={{ margin: "1rem 0 .5rem", fontSize: "1rem" }}>Transparent cut-outs ({cutouts.length})</h3>
            <div className="cutouts">
              {cutouts.map((c) => (
                <div key={c.id} className="cutout">
                  <a href={imageUrl(c.path)} target="_blank" rel="noreferrer" className="checker">
                    <img src={imageUrl(c.thumb_path)} alt="Transparent cut-out" />
                  </a>
                  <div className="row" style={{ gap: ".3rem", marginTop: ".3rem" }}>
                    {c.approved ? (
                      <a className="btn small ghost" href={imageUrl(c.path)} download={`${product.sku || "efj"}-cutout-${c.id}.png`}>⬇ PNG</a>
                    ) : (
                      <button className="btn small" title={c.fidelity_notes ?? c.model_used ?? ""} onClick={() => approve(c)}>
                        Check &amp; approve
                      </button>
                    )}
                    <button className="btn small danger" onClick={() => del(c)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card pad">
        <h2>2 · Studio shots <span className="badge">no generated pixels · colour enhanced</span></h2>
        <p className="muted">
          Retouched from your own photo (no AI-generated pixels), the way a retoucher would in Photoshop, automatically:
          white balance, levels, clarity, gold vibrance, sharpening and a soft sparkle, placed on a backdrop drawn by code,
          with your logo. Free and a few seconds each. Colour and shine are enhanced, so check each shot still matches the
          piece in daylight before you approve it.
        </p>
        <div className="chips">
          {LOOK_IDS.map((id) => (
            <label key={id} className={`chip ${studioLooks.includes(id) ? "on" : ""}`}>
              <input type="checkbox" checked={studioLooks.includes(id)}
                onChange={() => setStudioLooks(studioLooks.includes(id) ? studioLooks.filter((x) => x !== id) : [...studioLooks, id])} />
              {LOOKS[id].label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: ".7rem" }}>
          <select value={studioFormat} onChange={(e) => setStudioFormat(e.target.value as FormatId | "all")} style={{ width: "auto" }}>
            {(Object.keys(FORMATS) as FormatId[]).map((f) => <option key={f} value={f}>{FORMATS[f].label}</option>)}
            <option value="all">All three sizes</option>
          </select>
          <select value={studioPhotos} onChange={(e) => setStudioPhotos(e.target.value as "primary" | "all")} style={{ width: "auto" }}>
            <option value="primary">Main photo</option>
            <option value="all">All {originals.length} photos</option>
          </select>
          <label className="chip" style={{ margin: 0 }}>
            <input type="checkbox" checked={studioLogo} onChange={(e) => setStudioLogo(e.target.checked)} /> Add logo
          </label>
          <button className="btn" disabled={!!running || !originals.length || !studioLooks.length} onClick={makeStudio}>
            Make studio shots
          </button>
        </div>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 0 }}>
          Uses the transparent cut-out, so the same rules apply: gold finds itself anywhere, silver needs a plain backdrop.
          Keep the whole piece inside the photo frame. Reflections suit pieces lying flat (rings, earrings) best.
        </p>
      </div>

      <div className="card pad">
        <h2>3 · AI styled scenes</h2>
        <p className="muted">Your piece in a styled setting. Pick the looks you want.</p>
        <label className={`chip ${useSafe ? "on" : ""}`} style={{ marginBottom: ".7rem", opacity: realOnly ? 0.75 : 1 }}>
          <input type="checkbox" checked={useSafe} disabled={realOnly} onChange={(e) => setSafeMode(e.target.checked)} />
          {realOnly ? "Real product pixels on a drawn backdrop (always on)" : "Safe mode: keep my real product pixels, make only the background"}
        </label>
        <p className="muted" style={{ marginTop: 0, fontSize: ".85rem" }}>
          {realOnly
            ? "Your jewellery is cut out of your photo and placed on a backdrop drawn by code, so it can never change. The backdrops are clean, stylised surfaces rather than photographs. Looks best with a plain-background photo."
            : safeMode
            ? "Your jewellery is cut out of your photo and placed on an AI-made backdrop; the piece itself is not redrawn, but edges, shadow and colour can shift slightly, so check it against the piece. Looks best with a plain-background photo; lighting may feel less natural."
            : "Natural mode re-draws the whole scene, so light and reflections look real, but small details on the piece can drift. Check the match score before approving."}
        </p>
        <div className="chips">
          {SCENES.map((s) => (
            <label key={s.id} className={`chip ${selScenes.includes(s.id) ? "on" : ""}`}>
              <input type="checkbox" checked={selScenes.includes(s.id)} onChange={() => toggle(selScenes, setSelScenes, s.id)} />
              {s.label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: ".7rem" }}>
          <button
            className="btn" disabled={!!running || !selScenes.length || !originals.length}
            onClick={() => runJobs(selScenes.map((id) => ({
              label: SCENES.find((s) => s.id === id)!.label + (useSafe ? " · real product" : ""),
              body: { kind: "scene", preset: id, mode: useSafe ? "safe" : "natural" },
            })))}
          >
            Create {selScenes.length || ""} scene{selScenes.length === 1 ? "" : "s"}
          </button>
          <button className="btn small ghost" onClick={() => setSelScenes(selScenes.length ? [] : SCENES.map((s) => s.id))}>
            {selScenes.length ? "Clear" : "Select all"}
          </button>
        </div>
      </div>

      <div className="card pad">
        <h2>4 · AI on-model shots</h2>
        <p className="muted">The piece worn by a model. Use different skin tones so more customers see themselves.</p>
        {realOnly && <div className="notice">Off: on-model pictures are made by an AI, and you have chosen real photos only. Photograph the piece worn instead and add it on the product page.</div>}
        <div className="chips">
          {poses.map((s) => (
            <label key={s.id} className={`chip ${selPoses.includes(s.id) ? "on" : ""}`}>
              <input type="checkbox" checked={selPoses.includes(s.id)} onChange={() => toggle(selPoses, setSelPoses, s.id)} />
              {s.label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: ".7rem" }}>
          <select value={skin} onChange={(e) => setSkin(e.target.value)} style={{ width: "auto" }}>
            {SKIN_TONES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="all">All three tones</option>
          </select>
          <button
            className="btn" disabled={realOnly || !!running || !selPoses.length || !originals.length}
            onClick={() => {
              const tones = skin === "all" ? SKIN_TONES.map((t) => t.id) : [skin];
              runJobs(selPoses.flatMap((id) => tones.map((t) => ({
                label: `${poses.find((s) => s.id === id)!.label} (${SKIN_TONES.find((x) => x.id === t)!.label})`,
                body: { kind: "on_model", preset: id, skin: t },
              }))));
            }}
          >
            Create on-model shots
          </button>
        </div>
      </div>

      <div className="card pad">
        <h2>5 · AI scale shot</h2>
        <div className="notice">
          AI cannot guarantee true size. For rings and earrings, a real photo next to a coin is the honest way to show scale.
          Only approve an AI scale shot if the proportions match the real piece.
        </div>
        <button className="btn ghost" disabled={realOnly || !!running || !originals.length}
          onClick={() => runJobs([{ label: SCALE_PRESET.label, body: { kind: "scale" } }])}>
          Create scale shot
        </button>
      </div>

      {(running || log.length > 0 || note) && (
        <div className="card pad">
          {running && <p><b>{running}</b> <span className="muted">Each image can take up to a minute. Keep this page open.</span></p>}
          {note && <p className="muted">{note}</p>}
          {log.map((l, i) => <div key={i} className={l.ok ? "" : "error"}>{l.text}</div>)}
        </div>
      )}

      <h2 style={{ marginTop: "1.5rem" }}>Needs your review ({review.length})</h2>
      {review.length === 0
        ? <p className="muted">Nothing waiting. New images land here until you approve them.</p>
        : (
          <div className="tiles">
            {review.map((img) => (
              <ReviewTile key={img.id} img={img} category={product.category} fidelityMin={fidelityMin}
                onApprove={() => approve(img)} onDelete={() => del(img)} />
            ))}
          </div>
        )}

      <h2 style={{ marginTop: "1.5rem" }}>Approved library ({library.length})</h2>
      <div className="tiles">
        {library.map((img) => {
          const inCar = img.carousel_pos != null;
          return (
            <Tile key={img.id} img={img} fidelityMin={fidelityMin} highlight={inCar}>
              {inCar
                ? <button className="btn small ghost" onClick={() => putCarousel(carousel.filter((c) => c.id !== img.id).map((c) => c.id))}>✓ In carousel</button>
                : <button className="btn small" onClick={() => addToCarousel(img)}>+ Carousel</button>}
              {img.kind !== "original" && <button className="btn small ghost" onClick={() => patchImage(img.id, { approved: false })}>Unapprove</button>}
              <button className="btn small danger" onClick={() => del(img)}>Delete</button>
            </Tile>
          );
        })}
      </div>

      <PosterMaker product={product} images={images} onSaved={reload} />

      <div className="card pad" style={{ marginTop: "1rem" }}>
        <div className="toolbar" style={{ marginBottom: ".5rem" }}>
          <h2 className="grow" style={{ margin: 0 }}>6 · Carousel ({carousel.length}/{MAX_CAROUSEL})</h2>
          <button className="btn small ghost" onClick={autoArrange} disabled={!library.length}>Auto-arrange</button>
          {carousel.length > 0 && (
            <a className="btn small" href={`/api/products/${product.id}/carousel`}>⬇ Download ZIP</a>
          )}
        </div>
        <p className="muted">
          Suggested order: poster → studio shot → scene → on-model → real photo → scale → info card. The ZIP holds numbered 1080×1350 slides plus
          caption.txt, ready to post from your phone. Only approved images can be added.
        </p>
        {carousel.length === 0 ? (
          <p className="muted">Add images with “+ Carousel”, or press Auto-arrange.</p>
        ) : (
          <div className="strip">
            {carousel.map((img, i) => (
              <div
                key={img.id}
                className="slide"
                draggable
                onDragStart={() => { setDragIdx(i); setDragOverIdx(i); }}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                onDragEnd={() => {
                  if (dragIdx !== null && dragOverIdx !== null) dropSlide(dragIdx, dragOverIdx);
                  setDragIdx(null); setDragOverIdx(null);
                }}
                style={{
                  opacity: dragIdx === i ? 0.4 : 1,
                  outline: dragOverIdx === i && dragIdx !== i ? "2px solid var(--gold)" : undefined,
                  outlineOffset: 2,
                  borderRadius: 8,
                  cursor: "grab",
                  transition: "opacity .15s",
                }}
              >
                <div className="num">{i + 1}</div>
                <img src={imageUrl(img.thumb_path)} alt="" />
                <div style={{ textAlign: "center", fontSize: ".72rem", color: "var(--muted)", margin: ".15rem 0 .2rem", letterSpacing: 1 }}>&#x28FF; drag</div>
                <div className="row" style={{ justifyContent: "center", gap: ".25rem" }}>
                  <button className="btn small ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">&#9664;</button>
                  <button className="btn small ghost" onClick={() => putCarousel(carousel.filter((c) => c.id !== img.id).map((c) => c.id))} aria-label="Remove">&#x2715;</button>
                  <button className="btn small ghost" onClick={() => move(i, 1)} disabled={i === carousel.length - 1} aria-label="Move later">&#9654;</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Tile({
  img, fidelityMin, highlight, children,
}: { img: ProductImage; fidelityMin: number; highlight?: boolean; children: React.ReactNode }) {
  const score = img.fidelity_score;
  return (
    <div className={`tile ${highlight ? "hl" : ""}`}>
      <a href={imageUrl(img.path)} target="_blank" rel="noreferrer" className="pic">
        <img src={imageUrl(img.thumb_path)} alt={img.label ?? img.kind} />
      </a>
      <div className="row" style={{ gap: ".3rem", margin: ".4rem 0 .2rem" }}>
        <span className="badge">{KIND_LABEL[img.kind] ?? img.kind}</span>
        {img.model_used === "demo" && <span className="badge">demo</span>}
        {score != null && <span className={`badge ${score < fidelityMin ? "low" : "ok"}`}>match {score}%</span>}
      </div>
      {img.label && img.label !== KIND_LABEL[img.kind] && <div style={{ fontSize: ".85rem" }}>{img.label}</div>}
      {img.fidelity_notes && <div className="muted" style={{ fontSize: ".78rem" }}>{img.fidelity_notes}</div>}
      <div className="row" style={{ gap: ".3rem", marginTop: ".4rem" }}>{children}</div>
    </div>
  );
}

// Cutouts and generated pictures: the owner ticks each check against the real photo before Approve unlocks.
function ReviewTile({
  img, category, fidelityMin, onApprove, onDelete,
}: { img: ProductImage; category: string; fidelityMin: number; onApprove: () => void; onDelete: () => void }) {
  const checks = checklistFor(category, img.kind);
  const [ticked, setTicked] = useState<string[]>([]);
  const ready = checks.every((c) => ticked.includes(c));
  return (
    <Tile img={img} fidelityMin={fidelityMin}>
      {checks.length > 0 && (
        <div style={{ width: "100%", fontSize: ".82rem", marginBottom: ".3rem" }}>
          <div className="muted" style={{ marginBottom: ".2rem" }}>Compare with your real photo, then tick each:</div>
          {checks.map((c) => (
            <label key={c} style={{ display: "flex", gap: ".4rem", alignItems: "flex-start", margin: ".15rem 0" }}>
              <input type="checkbox" checked={ticked.includes(c)}
                onChange={() => setTicked(ticked.includes(c) ? ticked.filter((x) => x !== c) : [...ticked, c])} />
              {c}
            </label>
          ))}
          {img.kind === "on_model" && (
            <div className="muted" style={{ marginTop: ".3rem" }}>
              Not a sizing guide: on-model pictures do not show true size or fit.
            </div>
          )}
        </div>
      )}
      <button className="btn small" disabled={!ready} onClick={onApprove}>Approve</button>
      <button className="btn small danger" onClick={onDelete}>Delete</button>
    </Tile>
  );
}

