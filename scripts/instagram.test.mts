import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Let Node find "../config" as "../config.ts" (the app's bundler does this normally).
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

const TOKEN = "IGAAtest-token-abcdef123456";
let seen: { method?: string; url?: string; auth?: string; body?: Record<string, unknown> }[] = [];
type Reply = { status: number; body: unknown } | "hang-up";
// Keyed by "METHOD /path" or "/path". A function answers differently per request.
let replies: Record<string, Reply | ((body: Record<string, unknown>) => Reply)> = {};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d)).on("end", () => {
    const body = JSON.parse(raw || "{}");
    seen.push({ method: req.method, url: req.url, auth: String(req.headers.authorization), body });
    const path = (req.url || "").split("?")[0];
    const r = replies[`${req.method} ${path}`] ?? replies[path] ?? { status: 404, body: { error: { message: "not found" } } };
    const reply = typeof r === "function" ? r(body) : r;
    if (reply === "hang-up") return req.socket.destroy();
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.IG_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.IG_ACCESS_TOKEN = TOKEN;
process.env.IG_USER_ID = "1784";
process.env.IG_POLL_MS = "5";
process.env.IG_PROCESS_TIMEOUT_MS = "300";
process.env.IG_VIDEO_TIMEOUT_MS = "300";
process.env.IG_NOT_YET_WAIT_MS = "5";

const { checkToken, publishPost } = await import("../src/lib/providers/instagram.ts");

test.after(() => server.close());

test("checks the token with two GETs, token only in the header", async () => {
  seen = [];
  replies = {
    "/me": { status: 200, body: { user_id: "1784", username: "efj.studio", account_type: "BUSINESS", media_count: 12 } },
    "/1784/content_publishing_limit": { status: 200, body: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } },
  };
  const r = await checkToken();
  assert.equal(r.ok, true);
  assert.equal(r.username, "efj.studio");
  assert.equal(r.accountType, "BUSINESS");
  assert.equal(r.userIdMatches, true);
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.method, "GET");
    assert.equal(s.auth, `Bearer ${TOKEN}`);
    assert.ok(!s.url!.includes(TOKEN), "the token never goes in the URL");
  }
});

test("reports a mismatched user id and scrubs the token from errors", async () => {
  replies = {
    "/me": { status: 200, body: { user_id: "999", username: "other" } },
    "/1784/content_publishing_limit": { status: 400, body: { error: { message: `Bad token ${TOKEN}`, code: 190 } } },
  };
  const r = await checkToken();
  assert.equal(r.ok, false);
  assert.equal(r.userIdMatches, false);
  assert.equal(r.publishingLimit!.status, 400);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.match(r.publishingLimit!.error!, /code 190: Bad token \[token\]/);
});

// ---- Publishing ----

let nextId = 100;
const finished = { status: 200, body: { status_code: "FINISHED" } };
function publishMock(publish: Reply = { status: 200, body: { id: "9001" } }) {
  nextId = 100;
  seen = [];
  replies = {
    "POST /1784/media": () => ({ status: 200, body: { id: String(nextId++) } }),
    "POST /1784/media_publish": publish,
    "GET /9001": { status: 200, body: { permalink: "https://www.instagram.com/p/abc/" } },
  };
  for (let i = 100; i < 110; i++) replies[`GET /${i}`] = finished;
}
const posts = () => seen.filter((s) => s.method === "POST");

test("builds a carousel: children with alt text, then one CAROUSEL parent, then one publish", async () => {
  publishMock();
  const r = await publishPost({
    kind: "carousel",
    imageUrls: ["https://x.trycloudflare.com/a.jpg", "https://x.trycloudflare.com/b.jpg"],
    caption: "Hello #tag",
    altTexts: ["first", "second"],
  });
  assert.deepEqual(r, { ok: true, mediaId: "9001", permalink: "https://www.instagram.com/p/abc/" });
  const p = posts();
  assert.equal(p.length, 4);
  assert.deepEqual(p[0].body, { image_url: "https://x.trycloudflare.com/a.jpg", is_carousel_item: true, alt_text: "first" });
  assert.deepEqual(p[1].body, { image_url: "https://x.trycloudflare.com/b.jpg", is_carousel_item: true, alt_text: "second" });
  assert.deepEqual(p[2].body, { media_type: "CAROUSEL", children: "100,101", caption: "Hello #tag" });
  assert.equal(p[3].url, "/1784/media_publish");
  assert.deepEqual(p[3].body, { creation_id: "102" });
  for (const s of seen) {
    assert.equal(s.auth, `Bearer ${TOKEN}`);
    assert.ok(!s.url!.includes(TOKEN) && !JSON.stringify(s.body).includes(TOKEN), "the token only goes in the header");
  }
});

test("a Story is a STORIES container with no caption", async () => {
  publishMock();
  const r = await publishPost({ kind: "story", imageUrls: ["https://x.trycloudflare.com/s.jpg"] });
  assert.equal(r.ok, true);
  assert.deepEqual(posts()[0].body, { image_url: "https://x.trycloudflare.com/s.jpg", media_type: "STORIES" });
});

test("a lost publish answer is never retried and is reported as 'check Instagram'", async () => {
  publishMock("hang-up");
  const r = await publishPost({ kind: "image", imageUrls: ["https://x.trycloudflare.com/a.jpg"], caption: "Hi" });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
  assert.match(r.error!, /Check Instagram/);
  assert.equal(posts().filter((s) => s.url === "/1784/media_publish").length, 1);
});

test("an image Instagram cannot process stops before publishing, and errors are scrubbed", async () => {
  publishMock();
  replies["GET /100"] = { status: 200, body: { status_code: "ERROR" } };
  const r = await publishPost({ kind: "image", imageUrls: ["https://x.trycloudflare.com/a.jpg"], caption: "Hi" });
  assert.equal(r.ok, false);
  assert.ok(!seen.some((s) => s.url === "/1784/media_publish"));

  publishMock();
  replies["POST /1784/media"] = { status: 400, body: { error: { message: `bad ${TOKEN}`, code: 9004 } } };
  const r2 = await publishPost({ kind: "image", imageUrls: ["https://x.trycloudflare.com/a.jpg"], caption: "Hi" });
  assert.equal(r2.ok, false);
  assert.ok(!JSON.stringify(r2).includes(TOKEN));
  assert.ok(!seen.some((s) => s.url === "/1784/media_publish"));
});

test("still processing after the timeout: nothing is published", async () => {
  publishMock();
  replies["GET /100"] = { status: 200, body: { status_code: "IN_PROGRESS" } };
  const r = await publishPost({ kind: "image", imageUrls: ["https://x.trycloudflare.com/a.jpg"], caption: "Hi" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /Nothing was published/);
  assert.ok(!seen.some((s) => s.url === "/1784/media_publish"));
});

test("a Reel is a REELS container with the video address and caption, polled until FINISHED, then published once", async () => {
  publishMock();
  let polls = 0;
  replies["GET /100"] = () => ({ status: 200, body: { status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" } });
  const r = await publishPost({ kind: "reel", imageUrls: [], videoUrl: "https://x.trycloudflare.com/r.mp4", caption: "Hi #tag" });
  assert.equal(r.ok, true);
  assert.deepEqual(posts()[0].body, { media_type: "REELS", video_url: "https://x.trycloudflare.com/r.mp4", caption: "Hi #tag", share_to_feed: true });
  assert.equal(polls, 3);
  assert.deepEqual(posts()[1].body, { creation_id: "100" });
  assert.equal(posts().length, 2);
  // A Reel without a video is refused before anything is sent.
  publishMock();
  assert.equal((await publishPost({ kind: "reel", imageUrls: [] })).ok, false);
  assert.equal(seen.length, 0);
});

test("a Story refused with code 24 right after FINISHED is published again after a pause, and only then", async () => {
  publishMock();
  let tries = 0;
  replies["POST /1784/media_publish"] = () =>
    ++tries < 3 ? { status: 400, body: { error: { message: "The requested resource does not exist", code: 24 } } } : { status: 200, body: { id: "9001" } };
  const r = await publishPost({ kind: "story", imageUrls: ["https://x.trycloudflare.com/s.jpg"] });
  assert.equal(r.ok, true);
  assert.equal(tries, 3);
  assert.ok(seen.some((s) => s.method === "GET" && s.url!.startsWith("/100")), "the container is polled before publishing");
});

test("code 24 that never clears gives up after the retries; other refusals and photo posts are never retried", async () => {
  publishMock({ status: 400, body: { error: { message: "The requested resource does not exist", code: 24 } } });
  const r = await publishPost({ kind: "story", imageUrls: ["https://x.trycloudflare.com/s.jpg"] });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, undefined);
  assert.equal(posts().filter((s) => s.url === "/1784/media_publish").length, 4);

  publishMock({ status: 400, body: { error: { message: "Media type not supported", code: 9004 } } });
  await publishPost({ kind: "story", imageUrls: ["https://x.trycloudflare.com/s.jpg"] });
  assert.equal(posts().filter((s) => s.url === "/1784/media_publish").length, 1);

  publishMock({ status: 400, body: { error: { message: "The requested resource does not exist", code: 24 } } });
  await publishPost({ kind: "image", imageUrls: ["https://x.trycloudflare.com/a.jpg"], caption: "Hi" });
  assert.equal(posts().filter((s) => s.url === "/1784/media_publish").length, 1);
});
