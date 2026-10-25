"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scanText } from "@/lib/claims";
import { DM_WINDOW_MS, PRIVATE_REPLY_WINDOW_MS } from "@/lib/sendrules";

interface Thread { sender: string; label: string; last_at: number; last_text: string; messages: number; open_drafts: number; needs_owner: boolean }
interface Config { relay: boolean; token: boolean; mode: "off" | "live" }
interface Ev { id: number; kind: string; source: "relay" | "manual"; text: string; at: number; product_id: number | null; needs_owner: boolean; reason: string }
interface Draft { id: number; event_id: number; channel: "dm" | "comment_public" | "comment_private"; text: string; intents: string[]; status: string; error: string | null }
interface Prod { id: number; name: string; sku: string; price_cad: number | null; nickel_free: boolean | null; hypoallergenic: boolean | null }
interface ThreadData { items: { event: Ev; drafts: Draft[] }[]; products: Prod[] }

const CHANNEL: Record<string, string> = { dm: "Direct message", comment_public: "Public reply under the comment", comment_private: "Private message to the commenter" };
const KIND: Record<string, string> = { dm: "message", comment: "comment", story_reply: "story reply", story_mention: "story mention", postback: "button tap" };

const when = (ms: number) => new Date(ms).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

function windowNote(d: Draft, e: Ev): string | null {
  if (e.source === "manual" || d.status === "sent" || d.status === "dismissed") return null;
  const limit = d.channel === "dm" ? DM_WINDOW_MS : d.channel === "comment_private" ? PRIVATE_REPLY_WINDOW_MS : null;
  if (limit == null) return null;
  const left = e.at + limit - Date.now();
  if (left <= 0) return "Instagram's reply window has closed. Answer in the Instagram app.";
  const h = Math.floor(left / 3600_000);
  return h >= 48 ? `Reply window open for ${Math.floor(h / 24)} more days.` : `Reply window open for ${h} more hour${h === 1 ? "" : "s"}.`;
}

export default function InboxClient() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<ThreadData | null>(null);
  const [allProducts, setAllProducts] = useState<{ id: number; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ kind: "dm" as "dm" | "comment", label: "", text: "", productId: "" });
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const loadThread = useCallback(async (sender: string) => {
    const r = await fetch(`/api/inbox/thread?sender=${encodeURIComponent(sender)}`, { cache: "no-store" });
    if (r.ok) setData((await r.json()) as ThreadData);
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/inbox", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { threads: Thread[]; config: Config; products: { id: number; name: string }[] };
    setThreads(j.threads);
    setConfig(j.config);
    setAllProducts(j.products);
    if (selectedRef.current) await loadThread(selectedRef.current);
  }, [loadThread]);

  const sync = useCallback(async (quiet: boolean) => {
    if (!quiet) { setBusy("sync"); setErr(""); setMsg(""); }
    const r = await fetch("/api/inbox/sync", { method: "POST" });
    const j = (await r.json().catch(() => ({}))) as { fresh?: number; received?: number; error?: string };
    if (!r.ok) { if (!quiet) setErr(j.error ?? "Could not fetch messages."); }
    else if (!quiet) setMsg(j.fresh ? `${j.fresh} new message${j.fresh === 1 ? "" : "s"}.` : "No new messages.");
    await refresh();
    if (!quiet) setBusy("");
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While this page is open, look for new messages once a minute.
  useEffect(() => {
    if (!config) return;
    const t = setInterval(() => (config.relay ? sync(true) : refresh()), 60_000);
    return () => clearInterval(t);
  }, [config, sync, refresh]);

  async function open(sender: string) {
    setSelected(sender);
    setData(null);
    setMsg(""); setErr("");
    await loadThread(sender);
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy("manual"); setErr(""); setMsg("");
    const r = await fetch("/api/inbox/manual", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: form.kind, label: form.label, text: form.text, productId: form.productId ? Number(form.productId) : null }),
    });
    const j = (await r.json().catch(() => ({}))) as { sender?: string; error?: string; problems?: string[] };
    setBusy("");
    if (!r.ok) return setErr([j.error, ...(j.problems ?? [])].filter(Boolean).join(" "));
    setForm({ ...form, text: "" });
    await refresh();
    if (j.sender) await open(j.sender);
  }

  async function act(draftId: number, what: "send" | "dismiss" | "undo" | "sent" | { text: string }) {
    setBusy(`d${draftId}`); setErr(""); setMsg("");
    let r: Response;
    if (what === "send") r = await fetch(`/api/inbox/drafts/${draftId}/send`, { method: "POST" });
    else {
      const body = typeof what === "object" ? { text: what.text } : { status: what === "dismiss" ? "dismissed" : what === "undo" ? "pending" : "sent" };
      r = await fetch(`/api/inbox/drafts/${draftId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    setBusy("");
    if (!r.ok) setErr(j.message ?? j.error ?? "That did not work.");
    else if (j.message) setMsg(j.message);
    await refresh();
  }

  async function chooseProduct(eventId: number, productId: string) {
    setBusy(`e${eventId}`);
    await fetch(`/api/inbox/events/${eventId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: productId ? Number(productId) : null }),
    });
    setBusy("");
    await refresh();
  }

  return (
    <>
      <div className="notice">
        {config?.mode === "live" ? (
          <><b>Live sending is on.</b> Approved replies are sent through Instagram, one at a time, only when you press the button.</>
        ) : (
          <><b>Draft-only mode.</b> Approve a reply, then copy it into the Instagram app. Set <code>IG_SEND_MODE=live</code> in <code>.env.local</code> to send from here.</>
        )}{" "}
        {config?.relay ? "Connected to the relay." : "Not connected to Instagram yet: paste messages in below to try it."}
      </div>

      <div className="toolbar">
        {config?.relay && <button className="btn" disabled={busy === "sync"} onClick={() => sync(false)}>{busy === "sync" ? "Checking…" : "Check for new messages"}</button>}
        {msg && <span className="muted">{msg}</span>}
        {err && <span className="error">{err}</span>}
      </div>

      <div className="inbox">
        <div>
          <form className="card pad" onSubmit={addManual}>
            <h2>Add a message by hand</h2>
            <div className="fields">
              <div><label>Type</label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "dm" | "comment" })}>
                  <option value="dm">Direct message</option><option value="comment">Comment on a post</option>
                </select></div>
              <div><label>Customer (name or @handle)</label><input value={form.label} maxLength={60} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
              <div className="wide"><label>What they wrote</label><textarea value={form.text} maxLength={2000} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
              <div className="wide"><label>Which piece (optional)</label>
                <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Work it out from the message</option>
                  {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div className="wide"><button className="btn" disabled={busy === "manual" || !form.text.trim()}>Write a draft reply</button></div>
            </div>
          </form>

          <div className="card">
            {threads.length === 0 && <p className="pad muted" style={{ margin: 0 }}>No messages yet.</p>}
            {threads.map((t) => (
              <button key={t.sender} className={`thread${t.sender === selected ? " on" : ""}`} onClick={() => open(t.sender)}>
                <span className="who">{t.label}</span>
                <span className="when">{when(t.last_at)}</span>
                <span className="snip">{t.last_text || "(no text)"}</span>
                <span className="row">
                  {t.needs_owner && <span className="badge low">needs you</span>}
                  {t.open_drafts > 0 && <span className="badge warn">{t.open_drafts} to review</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected && <div className="card pad muted">Choose a customer on the left.</div>}
          {selected && !data && <div className="card pad muted">Loading…</div>}
          {selected && data && data.items.map(({ event, drafts }) => (
            <div key={event.id} className="card pad">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">{when(event.at)} · {KIND[event.kind] ?? event.kind}{event.source === "manual" ? " · added by hand" : ""}</span>
                <span className="row">
                  <label style={{ margin: 0 }}>Piece</label>
                  <select style={{ width: "auto", maxWidth: 220 }} value={event.product_id ?? ""} disabled={busy === `e${event.id}`} onChange={(e) => chooseProduct(event.id, e.target.value)}>
                    <option value="">not chosen</option>
                    {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </span>
              </div>
              <div className="bubble">{event.text || "(no text)"}</div>
              {event.needs_owner && <p className="error" style={{ margin: ".4rem 0" }}><b>Needs you:</b> {event.reason || "please review"}</p>}
              {drafts.length === 0 && <p className="muted">{event.needs_owner ? "No reply drafted. Answer this one yourself." : "No reply needed."}</p>}
              {drafts.map((d) => (
                <DraftBox key={`${d.id}:${d.text}:${d.status}`} d={d} e={event} prod={data.products.find((p) => p.id === event.product_id) ?? null}
                  live={config?.mode === "live"} busy={busy === `d${d.id}`} onAct={act} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function DraftBox({ d, e, prod, live, busy, onAct }: {
  d: Draft; e: Ev; prod: Prod | null; live: boolean; busy: boolean;
  onAct: (id: number, what: "send" | "dismiss" | "undo" | "sent" | { text: string }) => void;
}) {
  const [text, setText] = useState(d.text);
  const [copied, setCopied] = useState(false);
  const unsure = d.status === "unsure";
  const closed = d.status === "sent" || d.status === "dismissed" || d.status === "sending" || unsure;
  const problems = scanText(text, { hypoallergenic: prod?.hypoallergenic, nickel_free: prod?.nickel_free });
  const changed = text !== d.text;
  const note = windowNote(d, e);

  return (
    <div className="draft">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{CHANNEL[d.channel]}</b>
        <span className={`badge ${d.status === "sent" ? "ok" : d.status === "approved" || unsure ? "warn" : ""}`}>
          {d.status === "approved" ? "approved: send it in Instagram" : unsure ? "check Instagram" : d.status}
        </span>
      </div>
      <textarea value={text} disabled={closed || busy} maxLength={1000} onChange={(ev) => setText(ev.target.value)} />
      {problems.length > 0 && <p className="error" style={{ margin: ".3rem 0" }}>Wording we do not allow: {problems.join("; ")}.</p>}
      {note && <p className="muted" style={{ margin: ".3rem 0", fontSize: ".85rem" }}>{note}</p>}
      {d.error && <p className="error" style={{ margin: ".3rem 0" }}>{d.error}</p>}
      {unsure && <p style={{ margin: ".3rem 0" }}><b>Open the conversation in Instagram.</b> If the customer got the reply, press &ldquo;I sent it&rdquo;. If not, press &ldquo;Try again&rdquo;.</p>}
      <div className="row">
        {!closed && changed && <button className="btn ghost small" disabled={busy} onClick={() => onAct(d.id, { text })}>Save edit</button>}
        {!closed && (
          <button className="btn small" disabled={busy || changed || problems.length > 0 || !text.trim()} onClick={() => onAct(d.id, "send")}>
            {live ? "Approve & send" : "Approve"}
          </button>
        )}
        {(d.status === "approved" || (!live && !closed)) && (
          <button className="btn ghost small" disabled={!text.trim()} onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
        )}
        {(d.status === "approved" || unsure) && <button className="btn ghost small" disabled={busy} onClick={() => onAct(d.id, "sent")}>I sent it</button>}
        {unsure && <button className="btn ghost small" disabled={busy} onClick={() => onAct(d.id, "undo")}>Try again</button>}
        {unsure && <button className="btn danger small" disabled={busy} onClick={() => onAct(d.id, "dismiss")}>Don&apos;t reply</button>}
        {!closed && <button className="btn danger small" disabled={busy} onClick={() => onAct(d.id, "dismiss")}>Don&apos;t reply</button>}
        {d.status === "dismissed" && <button className="btn ghost small" disabled={busy} onClick={() => onAct(d.id, "undo")}>Undo</button>}
      </div>
    </div>
  );
}
