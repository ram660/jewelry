import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Let Node find "./config" as "./config.ts" (the app's bundler does this normally).
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

let script: { status: number; body: unknown }[] = [];
let calls = 0;
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const step = script[Math.min(calls, script.length - 1)];
    calls++;
    res.writeHead(step.status, { "content-type": "application/json" });
    res.end(JSON.stringify(step.body));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_RETRY_MS = "10";

const { geminiJson } = await import("../src/lib/providers/gemini.ts");
const busy = { status: 503, body: { error: { code: 503, message: "This model is currently experiencing high demand." } } };
const good = { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] } };
const run = () => { calls = 0; return geminiJson("x", [Buffer.from("jpg")]); };

test("a brief overload is retried and then succeeds", async () => {
  script = [busy, busy, good];
  assert.equal(await run(), '{"ok":true}');
  assert.equal(calls, 3);
});

test("one overload then success uses two calls", async () => {
  script = [busy, good];
  assert.equal(await run(), '{"ok":true}');
  assert.equal(calls, 2);
});

test("a lasting overload gives up after three tries with a clear message", async () => {
  script = [busy];
  await assert.rejects(run(), /high demand/);
  assert.equal(calls, 3);
});

test("quota and key problems are not retried", async () => {
  script = [{ status: 429, body: { error: { code: 429, message: "quota" } } }];
  await assert.rejects(run(), /rate limit or quota/);
  assert.equal(calls, 1);
  script = [{ status: 400, body: { error: { code: 400, message: "API key not valid" } } }];
  await assert.rejects(run(), /rejected the API key/);
  assert.equal(calls, 1);
});

test.after(() => server.close());
