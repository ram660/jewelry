"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface KitSummary { slug: string; title: string; cover: string | null; posted: string[] }
interface Status { kits: KitSummary[]; cutout: boolean; ai: string | null; instagram: boolean }

const POSTED: Record<string, string> = { feed: "posted", story: "Story", reel: "Reel" };

/** Upright JPEG of at most 3000px on the long side (the Studio uses no more), so a batch of phone photos stays small. */
async function shrink(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    if (k === 1 && f.type === "image/jpeg" && f.size < 6_000_000) return f;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    return out ?? f;
  } catch {
    return f; // the server reads it (or says it can't)
  }
}

/** Plain words for a request that never got an answer. */
const unreachable = (e: unknown) =>
  e instanceof TypeError ? "Couldn't reach the Studio. Check that npm run dev is still running, then try again." : e instanceof Error ? e.message : String(e);

async function sha(f: File) {
  const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Step 1 of 3: drop the photos and name the piece. The Studio makes the images and the AI writes the post. */
export default function InstagramPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<{ file: File; dup: boolean }[]>([]);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/instagram/kits").then((r) => r.json()).then(setStatus, () => setError("Could not load the kits."));
  }, []);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f.file)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // The same photo twice is shown greyed out and not uploaded.
  async function addFiles(list: FileList | File[]) {
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name));
    const known = new Set(await Promise.all(files.map((f) => sha(f.file))));
    const next: { file: File; dup: boolean }[] = [];
    for (const file of imgs) {
      const h = await sha(file);
      next.push({ file, dup: known.has(h) });
      known.add(h);
    }
    setFiles((prev) => [...prev, ...next]);
  }

  async function submit() {
    setError("");
    const keep = files.filter((f) => !f.dup);
    if (!keep.length) return setError("Add at least one photo.");
    if (name.trim().length < 2) return setError("Give the piece a name.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      for (const f of keep) fd.append("files", await shrink(f.file), f.file.name.replace(/\.\w+$/, "") + ".jpg");
      const r = await fetch("/api/instagram/kits", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: `The Studio answered with an error (${r.status}).` }));
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      router.push(`/instagram/${j.slug}?job=${j.jobId}`);
    } catch (e) {
      setError(unreachable(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Instagram</h1>
      <ol className="ig-steps">
        <li className="on">Add photos</li>
        <li>Review the post</li>
        <li>Post</li>
      </ol>

      {status && !status.cutout && <p className="notice error">The cutout model isn&apos;t installed. Run <code>node scripts/get-birefnet.mjs lite</code> once.</p>}
      {status && !status.ai && <p className="notice">AI isn&apos;t set up (no vision key in Settings), so captions will be simple templates you can edit.</p>}

      <div className="card pad">
        <div
          className={`drop ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          <p>Drop the photos of one piece here</p>
          <label className="btn" style={{ color: "#fff", margin: 0 }}>
            Choose photos
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </label>
        </div>
        {files.length > 0 && (
          <div className="thumbs">
            {files.map((f, i) => (
              <div className="t" key={previews[i]} title={f.dup ? "Same photo twice: left out." : f.file.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[i]} alt="" style={f.dup ? { opacity: 0.35 } : undefined} />
                {f.dup && <span className="muted" style={{ fontSize: ".75rem" }}>repeat, left out</span>}
                <button type="button" aria-label="Remove photo" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: "1rem", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label htmlFor="ig-name">Name of the piece</label>
            <input id="ig-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Clover set" onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <button className="btn" disabled={busy || (status ? !status.cutout : true)} onClick={submit}>
            {busy ? "Uploading…" : "Next"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>
          Leave out photos where a mark or logo is stamped on the piece. Only the background is replaced; the jewellery is never changed.
        </p>
      </div>

      {status && status.kits.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Earlier posts</h2>
          <div className="ig-kits">
            {status.kits.map((k) => (
              <Link key={k.slug} href={`/instagram/${k.slug}`} className="card ig-kit">
                {k.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/instagram/kits/${k.slug}/file/${k.cover}`} alt="" loading="lazy" />
                ) : (
                  <div className="ig-kit-empty muted">being made…</div>
                )}
                <div className="ig-kit-title">{k.title}</div>
                <div className="ig-kit-tags">
                  {k.posted.length ? k.posted.map((p) => <span key={p} className="badge">{POSTED[p] ?? p}</span>) : <span className="muted">not posted</span>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
