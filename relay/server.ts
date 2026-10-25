// Runs the relay on any machine with Node 22.13+:   node relay/server.ts
// Required environment (the server refuses to start without them):
//   RELAY_APP_SECRET    Instagram app secret, and optionally the Meta app secret after a comma
//   RELAY_VERIFY_TOKEN  any long random string; paste the same one into Meta's webhook setup
//   RELAY_PULL_TOKEN    another long random string; the Studio sends it to collect events
// Optional: RELAY_DB (default ./relay-data/events.db), PORT (default 8787)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRelay } from "./relay.ts";
import { SqliteStore } from "./sqlite-store.ts";

const secrets = (process.env.RELAY_APP_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const verifyToken = process.env.RELAY_VERIFY_TOKEN ?? "";
const pullToken = process.env.RELAY_PULL_TOKEN ?? "";
for (const [name, ok] of [["RELAY_APP_SECRET", secrets.length > 0], ["RELAY_VERIFY_TOKEN", !!verifyToken], ["RELAY_PULL_TOKEN", !!pullToken]] as const) {
  if (!ok) { console.error(`Missing ${name}. See the comment at the top of relay/server.ts.`); process.exit(1); }
}
if (pullToken.length < 24 || verifyToken.length < 24) {
  console.error("RELAY_VERIFY_TOKEN and RELAY_PULL_TOKEN must each be at least 24 characters.");
  process.exit(1);
}

if (pullToken === verifyToken) {
  // The verify token is also typed into Meta's dashboard. It must not be able to read the queue.
  console.error("RELAY_VERIFY_TOKEN and RELAY_PULL_TOKEN must be different.");
  process.exit(1);
}

const dbFile = process.env.RELAY_DB ?? "./relay-data/events.db";
fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
const relay = createRelay({ appSecrets: secrets, verifyToken, pullToken, store: new SqliteStore(dbFile) });
const MAX = 256 * 1024;

http
  .createServer(async (nreq, nres) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of nreq) {
        size += (c as Buffer).length;
        if (size > MAX) { nres.writeHead(413).end(); nreq.destroy(); return; }
        chunks.push(c as Buffer);
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === "string") headers.set(k, v);
      const method = nreq.method ?? "GET";
      const res = await relay(
        new Request(`http://relay${nreq.url ?? "/"}`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks) })
      );
      nres.writeHead(res.status, Object.fromEntries(res.headers));
      nres.end(Buffer.from(await res.arrayBuffer()));
    } catch {
      nres.writeHead(500).end();
    }
  })
  .listen(Number(process.env.PORT) || 8787, () => console.log("EFJ relay listening"));
