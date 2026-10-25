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

const KEY = "sk-or-v1-test-key-123456";
let seen: { auth?: string; title?: string; body?: Record<string, unknown> } = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d)).on("end", () => {
    seen = { auth: String(req.headers.authorization), title: String(req.headers["x-title"]), body: JSON.parse(raw || "{}") };
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.OPENROUTER_API_KEY = KEY;

const { openrouterJson } = await import("../src/lib/providers/openrouter.ts");
const { visionProvider, openrouterModels, DEFAULT_OPENROUTER_MODELS, activeVisionModel } = await import("../src/lib/config.ts");
const jpeg = Buffer.from("fake-jpeg-bytes");
const ok = (content: string, extra: object = {}) => ({ status: 200, body: { model: "x", choices: [{ message: { content }, finish_reason: "stop", ...extra }] } });

test("sends the model list, a generous token limit, the photo and the key as a header", async () => {
  reply = ok('{"a":1}');
  const text = await openrouterJson("describe", [jpeg], { maxTokens: 1500, temperature: 0 });
  assert.equal(text, '{"a":1}');
  assert.equal(seen.auth, `Bearer ${KEY}`);
  assert.equal(seen.title, "EFJ Studio");
  assert.deepEqual(seen.body!.models, DEFAULT_OPENROUTER_MODELS);
  assert.ok((seen.body!.max_tokens as number) >= 6000, "reasoning models need room to think");
  assert.equal(seen.body!.temperature, 0);
  assert.deepEqual(seen.body!.response_format, { type: "json_object" });
  assert.equal(seen.body!.provider, undefined);
  const content = (seen.body!.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0].content;
  assert.equal(content[0].type, "text");
  assert.equal(content[1].image_url!.url, "data:image/jpeg;base64," + jpeg.toString("base64"));
});

test("a larger limit asked for by the caller is kept", async () => {
  reply = ok("{}");
  await openrouterJson("x", [jpeg], { maxTokens: 9000 });
  assert.equal(seen.body!.max_tokens, 9000);
});

test("strict privacy asks for providers that do not keep or train on prompts", async () => {
  process.env.OPENROUTER_PRIVACY = "strict";
  reply = ok("{}");
  await openrouterJson("x", [jpeg]);
  assert.deepEqual(seen.body!.provider, { data_collection: "deny" });
  delete process.env.OPENROUTER_PRIVACY;
});

test("thinking printed inside <think> tags is removed", async () => {
  reply = ok('<think>let me see... {"wrong": true}</think>\n{"right": true}');
  assert.equal(await openrouterJson("x", [jpeg]), '{"right": true}');
});

test("errors are clear and never contain the key", async () => {
  reply = { status: 401, body: { error: { message: "No auth", code: 401 } } };
  await assert.rejects(openrouterJson("x", [jpeg]), /rejected the API key/);
  reply = { status: 402, body: { error: { message: "Insufficient credits", code: 402 } } };
  await assert.rejects(openrouterJson("x", [jpeg]), /no credits/);
  reply = { status: 429, body: { error: { message: "Rate limit exceeded: free-models-per-day", code: 429 } } };
  await assert.rejects(openrouterJson("x", [jpeg]), /free usage limit is reached/);
  reply = { status: 500, body: { error: { message: `boom with ${KEY} inside`, code: 500 } } };
  await assert.rejects(openrouterJson("x", [jpeg]), (e: Error) => /failed \(500\)/.test(e.message) && !e.message.includes(KEY));
});

test("a retired model in the list is dropped and the rest still run", async () => {
  process.env.OPENROUTER_MODELS = "gone/retired:free,good/one:free,good/two:free";
  let calls = 0;
  // The mock refuses any request that still lists the retired model, and answers normally otherwise.
  const seenModels: string[][] = [];
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let raw = "";
    req.on("data", (d) => (raw += d)).on("end", () => {
      const b = JSON.parse(raw);
      seenModels.push(b.models);
      calls++;
      const retired = (b.models as string[]).includes("gone/retired:free");
      res.writeHead(retired ? 400 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(retired ? { error: { message: "gone/retired:free is not a valid model ID", code: 400 } } : { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    });
  };
  server.removeAllListeners("request");
  server.on("request", handler);
  assert.equal(await openrouterJson("x", [jpeg]), '{"ok":true}');
  assert.equal(calls, 2);
  assert.deepEqual(seenModels[1], ["good/one:free", "good/two:free"]);
  // If the only model is invalid there is nothing to fall back to, and the error says so.
  process.env.OPENROUTER_MODELS = "gone/retired:free";
  await assert.rejects(openrouterJson("x", [jpeg]), /not a valid model ID/);
  delete process.env.OPENROUTER_MODELS;
});

test("an empty or cut-off answer is an error, not silent bad data", async () => {
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d)).on("end", () => {
      seen = { auth: String(req.headers.authorization), title: String(req.headers["x-title"]), body: JSON.parse(raw || "{}") };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  reply = ok("");
  await assert.rejects(openrouterJson("x", [jpeg]), /empty reply/);
  reply = ok("{\"a\":", { finish_reason: "length" });
  await assert.rejects(openrouterJson("x", [jpeg]), /cut off/);
});

test("settings: explicit choice, last in auto, and a model list that can be changed", () => {
  const keep = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPINFRA_API_KEY", "VISION_PROVIDER", "AI_PROVIDER", "OPENROUTER_MODELS"]) delete process.env[k];
  assert.equal(visionProvider(), "openrouter"); // only key present, auto picks it
  process.env.GEMINI_API_KEY = "g";
  assert.equal(visionProvider(), "gemini"); // an existing provider is never replaced in auto
  process.env.VISION_PROVIDER = "openrouter";
  assert.equal(visionProvider(), "openrouter"); // unless chosen on purpose
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(visionProvider(), null); // chosen but no key
  process.env.OPENROUTER_API_KEY = KEY;
  process.env.OPENROUTER_MODELS = " a/one:free , b/two:free,c/three,d/four ";
  assert.deepEqual(openrouterModels(), ["a/one:free", "b/two:free", "c/three"]);
  assert.equal(activeVisionModel(), "a/one:free");
  Object.assign(process.env, keep);
  delete process.env.OPENROUTER_MODELS; delete process.env.VISION_PROVIDER; delete process.env.GEMINI_API_KEY;
});

test.after(() => server.close());
