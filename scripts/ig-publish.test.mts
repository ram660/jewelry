import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";

// Runs scripts/ig-publish.mts against a mock Studio. No tunnel (EFJ_PUBLIC_URL=local) and no Instagram.
let calls: { method?: string; url?: string; body?: { kind: string; imageUrls: string[]; caption: string; altTexts: string[]; confirm: boolean } }[] = [];
let fetched: number[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, mediaId: "9001", permalink: "https://www.instagram.com/p/abc/" } };

const studio = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d)).on("end", async () => {
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method, url: req.url, body });
    if (req.url === "/api/products") return res.writeHead(200, { "content-type": "application/json" }).end("[]");
    // Like Instagram, download each image before answering.
    for (const u of body?.imageUrls ?? []) fetched.push((await fetch(u)).status);
    res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
  });
});
await new Promise<void>((r) => studio.listen(0, "127.0.0.1", r));
test.after(() => studio.close());
const STUDIO = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;

const NOTES = (caption: string, alt = "Gold-tone heart studs on a cream background.") => `# Test: Instagram post

## Caption (pick one)

**One**

> ${caption}
>
> Second line.

**Two**

> Another caption ✨

## Hashtags

\`\`\`
#ElegantFashionJewellery #vancouverjewellery
\`\`\`

## Alt text

- **Slide 1:** ${alt}
- **Slide 2:** Close-up of the studs.
- **Story / square:** Heart studs.
`;

const kits: string[] = [];
test.after(() => kits.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function kit(notes: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efj-kit-"));
  kits.push(dir);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  for (const f of ["t_1_4x5_1080x1350.jpg", "t_1_closeup_4x5_1080x1350.jpg", "t_1_1x1_1080x1080.jpg", "t_1_story_9x16_1080x1920.jpg"]) {
    fs.writeFileSync(path.join(dir, f), jpg);
  }
  fs.writeFileSync(path.join(dir, "t_post-notes.md"), notes);
  return dir;
}

function run(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--no-warnings", "scripts/ig-publish.mts", ...args],
      { env: { ...process.env, EFJ_URL: STUDIO, EFJ_PUBLIC_URL: "local" } },
      (err, stdout, stderr) => resolve({ code: err ? (err.code as number) : 0, out: stdout + stderr })
    );
  });
}

const reset = () => ((calls = []), (fetched = []));

test("the default is a dry run: a preview, and nothing sent", async () => {
  reset();
  const r = await run(kit(NOTES("Little hearts, big love 💛")));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /DRY RUN/);
  assert.match(r.out, /Feed post: carousel of 2/);
  assert.match(r.out, /Story/);
  assert.match(r.out, /Little hearts, big love/);
  assert.match(r.out, /#ElegantFashionJewellery/);
  assert.match(r.out, /alt: Gold-tone heart studs/);
  assert.equal(calls.length, 0);
});

test("--caption picks another caption", async () => {
  const r = await run(kit(NOTES("First")), "--caption", "2");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Caption 2 of 2/);
  assert.match(r.out, /Another caption/);
});

test("bracketed blanks and banned wording are refused, even with --confirm", async () => {
  reset();
  const blanks = await run(kit(NOTES("$[PRICE] CAD. [ORDER CTA]")), "--confirm");
  assert.equal(blanks.code, 1);
  assert.match(blanks.out, /Fill in or remove: \[PRICE\], \[ORDER CTA\]/);
  const altBlank = await run(kit(NOTES("Fine", "[WHAT THE PIECE LOOKS LIKE]")), "--confirm");
  assert.equal(altBlank.code, 1);
  const banned = await run(kit(NOTES("Solid gold hearts")), "--confirm");
  assert.equal(banned.code, 1);
  assert.match(banned.out, /Fix before publishing/);
  assert.equal(calls.length, 0);
});

test("--confirm publishes the carousel then the Story, logs them, and refuses to publish twice", async () => {
  reset();
  answer = { status: 200, body: { ok: true, mediaId: "9001", permalink: "https://www.instagram.com/p/abc/" } };
  const dir = kit(NOTES("Little hearts"));
  const r = await run(dir, "--confirm");
  assert.equal(r.code, 0, r.out);
  const pubs = calls.filter((c) => c.url === "/api/instagram/publish");
  assert.deepEqual(pubs.map((c) => c.body!.kind), ["carousel", "story"]);
  assert.equal(pubs[0].body!.imageUrls.length, 2);
  assert.equal(pubs[0].body!.confirm, true);
  assert.match(pubs[0].body!.caption, /Little hearts[\s\S]*#vancouverjewellery/);
  assert.deepEqual(pubs[0].body!.altTexts, ["Gold-tone heart studs on a cream background.", "Close-up of the studs."]);
  for (const u of pubs.flatMap((c) => c.body!.imageUrls)) assert.match(u, /\/[0-9a-f]{32}\.jpg$/, "random, unguessable names");
  assert.deepEqual(fetched, [200, 200, 200]);
  const log = JSON.parse(fs.readFileSync(path.join(dir, `${path.basename(dir)}_published.json`), "utf8"));
  assert.deepEqual(log.map((e: { kind: string; status: string }) => `${e.kind}:${e.status}`), ["carousel:published", "story:published"]);

  reset();
  const again = await run(dir, "--confirm");
  assert.equal(again.code, 1);
  assert.match(again.out, /already has a feed post and Story/);
  assert.equal(calls.length, 0);
});

test("a publish with no clear answer is logged as check-instagram and blocks a second try", async () => {
  reset();
  answer = { status: 504, body: { ok: false, unknown: true, error: "may be live" } };
  const dir = kit(NOTES("Little hearts"));
  const r = await run(dir, "--confirm", "--no-story");
  assert.equal(r.code, 1);
  assert.match(r.out, /Check Instagram/);
  const log = JSON.parse(fs.readFileSync(path.join(dir, `${path.basename(dir)}_published.json`), "utf8"));
  assert.equal(log[0].status, "check-instagram");
  reset();
  const again = await run(dir, "--confirm", "--no-story");
  assert.equal(again.code, 1);
  assert.equal(calls.length, 0);
});

test("the image server only serves its own files: 404 for anything else, 405 for other methods", async () => {
  // Checked inside one publish: the mock Studio probes the server while it is up.
  reset();
  let probes: number[] = [];
  answer = { status: 200, body: { ok: true, mediaId: "1" } };
  const probe = studio.listeners("request")[0] as http.RequestListener;
  studio.removeAllListeners("request");
  studio.on("request", (req, res) => {
    if (req.url === "/api/instagram/publish") {
      let raw = "";
      req.on("data", (d) => (raw += d)).on("end", async () => {
        const u = new URL(JSON.parse(raw).imageUrls[0]);
        probes = [
          (await fetch(u.origin + "/")).status,
          (await fetch(u.origin + "/../t_post-notes.md")).status,
          (await fetch(u.origin + "/t_1_4x5_1080x1350.jpg")).status,
          (await fetch(u, { method: "POST" })).status,
        ];
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
      });
      return;
    }
    probe(req, res);
  });
  try {
    const r = await run(kit(NOTES("Little hearts")), "--confirm", "--single", "--no-story");
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(probes, [404, 404, 404, 405]);
  } finally {
    studio.removeAllListeners("request");
    studio.on("request", probe);
  }
});
