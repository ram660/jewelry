import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { findTool } from "./tools";

/**
 * Instagram downloads each photo or video from a public https address. For one publish only, this copies the files to a
 * temp folder under random names, serves just those files from a tiny server on 127.0.0.1, and opens a Cloudflare quick
 * tunnel (cloudflared) to that server alone. The Studio itself is never exposed. The tunnel, the server and the temp folder
 * are removed afterwards, also on errors and Ctrl+C.
 * Used by scripts/ig-publish.mts and the Instagram page. Server-only (Node).
 */

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4" };

/** How long a new quick tunnel gets to start serving the first file. */
const TUNNEL_READY_MS = Number(process.env.EFJ_TUNNEL_READY_MS) || 120_000;

/** Serves copies of the given files (names inside dir) at public https addresses for the duration of fn, then removes everything. */
export async function withPublicFiles<T>(dir: string, names: string[], fn: (urls: string[]) => Promise<T>, log: (line: string) => void = () => {}): Promise<T> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "efj-share-"));
  const served = new Map<string, { file: string; type: string }>();
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    const type = TYPES[ext];
    if (!type) throw new Error(`Only JPEG photos and MP4 videos can be shared (${name}).`);
    const id = `${randomBytes(16).toString("hex")}${ext === ".jpeg" ? ".jpg" : ext}`;
    fs.copyFileSync(path.join(dir, name), path.join(tmp, id));
    served.set(`/${id}`, { file: path.join(tmp, id), type });
  }
  const server = http.createServer((req, res) => {
    const hit = served.get((req.url ?? "").split("?")[0]);
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
    if (!hit) return res.writeHead(404).end();
    const data = fs.readFileSync(hit.file);
    res.writeHead(200, { "Content-Type": hit.type, "Content-Length": data.length, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
  let tunnel: ChildProcess | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    tunnel?.kill();
    server.closeAllConnections();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  // Ctrl+C exits straight away, so cleanup also runs on exit.
  const onSignal = () => process.exit(130);
  process.once("exit", cleanup).once("SIGINT", onSignal).once("SIGTERM", onSignal);
  try {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    // Tests set EFJ_PUBLIC_URL=local to skip the tunnel and use the local address.
    let publicBase = process.env.EFJ_PUBLIC_URL === "local" ? `http://127.0.0.1:${port}` : "";
    if (!publicBase) {
      const exe = findTool("cloudflared", "Cloudflare.cloudflared") ?? "cloudflared";
      log("Opening the tunnel…");
      tunnel = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
      publicBase = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("cloudflared did not give a tunnel address within 45 s.")), 45_000);
        const scan = (d: Buffer) => {
          const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (m) clearTimeout(timer), resolve(m[0]);
        };
        tunnel!.stdout!.on("data", scan);
        tunnel!.stderr!.on("data", scan);
        tunnel!.once("error", (e) => (clearTimeout(timer), reject(new Error(`Could not start cloudflared (${e.message}). Install it with: winget install Cloudflare.cloudflared`))));
        tunnel!.once("exit", (code) => (clearTimeout(timer), reject(new Error(`cloudflared stopped (exit ${code}).`))));
      });
    }
    const urls = [...served.keys()].map((p) => publicBase + p);
    const firstType = [...served.values()][0]?.type;
    // A new quick tunnel takes a while to answer (its address has to reach DNS first). Make sure the internet can see the
    // first file before Instagram tries. Failed lookups and connection errors just mean "not yet".
    const until = Date.now() + TUNNEL_READY_MS;
    for (;;) {
      const ok = await fetch(urls[0], { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok && r.headers.get("content-type") === firstType, () => false);
      if (ok) break;
      if (Date.now() > until) throw new Error(`The tunnel address did not serve the files within ${Math.round(TUNNEL_READY_MS / 1000)} s. Nothing was published.`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    log("Tunnel is up.");
    return await fn(urls);
  } finally {
    process.off("exit", cleanup).off("SIGINT", onSignal).off("SIGTERM", onSignal);
    cleanup();
  }
}
