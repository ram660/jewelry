"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoSettings({ custom }: { custom: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(0); // cache-buster for the previews
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg(""); setErr("");
    const fd = new FormData();
    fd.set("file", f);
    const r = await fetch("/api/brand/logo", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error || "Could not save the logo.");
    setMsg("Logo saved ✓ New studio shots will use it.");
    setV((x) => x + 1);
    router.refresh();
  }

  async function reset() {
    if (!confirm("Go back to the placeholder logo?")) return;
    await fetch("/api/brand/logo", { method: "DELETE" });
    setMsg("Back to the placeholder logo.");
    setV((x) => x + 1);
    router.refresh();
  }

  return (
    <div className="card pad">
      <h2>Brand logo</h2>
      <p className="muted">
        {custom ? "Your logo" : "A placeholder logo, drawn by code"} is added small at the bottom of studio shots. Upload your
        own to replace it everywhere: a <b>transparent PNG</b> works best (PNG, JPG or WebP, up to 5 MB).
      </p>
      <div className="row" style={{ gap: "1rem", alignItems: "stretch" }}>
        <div className="logo-preview" style={{ background: "#faf6ee" }}>
          <img src={`/api/brand/logo?ink=dark&v=${v}`} alt="Logo on a light background" />
        </div>
        <div className="logo-preview" style={{ background: "#1b191f" }}>
          <img src={`/api/brand/logo?ink=light&v=${v}`} alt="Logo on a dark background" />
        </div>
      </div>
      <div className="row" style={{ marginTop: ".8rem" }}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "Upload my logo"}</button>
        {custom && <button className="btn ghost" onClick={reset}>Use the placeholder</button>}
        {msg && <span style={{ color: "var(--ok)" }}>{msg}</span>}
        {err && <span className="error">{err}</span>}
      </div>
    </div>
  );
}
