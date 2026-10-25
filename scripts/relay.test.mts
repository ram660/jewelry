import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore, createRelay, parseWebhook, verifySignature } from "../relay/relay.ts";
import { SqliteStore } from "../relay/sqlite-store.ts";

const SECRET = "app-secret-for-tests";
const VERIFY = "verify-token-for-tests-0123456789";
const PULL = "pull-token-for-tests-0123456789";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const dm = (mid: string, text = "How much is the Aria ring?") => ({
  object: "instagram",
  entry: [{ id: "BIZ1", time: 1, messaging: [{ sender: { id: "CUST1" }, recipient: { id: "BIZ1" }, timestamp: 1700000000000, message: { mid, text } }] }],
});
const comment = (id: string, text = "price?") => ({
  object: "instagram",
  entry: [{ id: "BIZ1", time: 1, changes: [{ field: "comments", value: { id, text, from: { id: "CUST2", username: "x" }, media: { id: "MEDIA9" } } }] }],
});

function make(store = new MemoryStore(), extra: Partial<Parameters<typeof createRelay>[0]> = {}) {
  const relay = createRelay({ appSecrets: [SECRET], verifyToken: VERIFY, pullToken: PULL, store, ...extra });
  const post = (payload: unknown, header?: string | null) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    const sig = header === undefined ? sign(body) : header;
    if (sig) headers["x-hub-signature-256"] = sig;
    return relay(new Request("https://relay.test/webhook", { method: "POST", headers, body }));
  };
  const pull = (after = 0, token: string | null = PULL) =>
    relay(new Request(`https://relay.test/events?after=${after}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  return { relay, post, pull, store };
}

test("signature: accepts the right secret, rejects everything else", async () => {
  const body = '{"a":1}';
  assert.equal(await verifySignature(body, sign(body), [SECRET]), true);
  assert.equal(await verifySignature(body, sign(body, "other"), [SECRET]), false);
  assert.equal(await verifySignature(body + " ", sign(body), [SECRET]), false);
  assert.equal(await verifySignature(body, null, [SECRET]), false);
  assert.equal(await verifySignature(body, "sha256=", [SECRET]), false);
  assert.equal(await verifySignature(body, sign(body), []), false);
  assert.equal(await verifySignature(body, sign(body, "second"), ["first", "second"]), true);
});

test("webhook: unsigned or wrongly signed deliveries are refused and nothing is stored", async () => {
  const { post, pull } = make();
  assert.equal((await post(dm("m1"), null)).status, 401);
  assert.equal((await post(dm("m1"), sign("x"))).status, 401);
  const r = await (await pull()).json();
  assert.deepEqual(r.events, []);
});

test("webhook: stores a signed DM and a comment", async () => {
  const { post, pull } = make();
  assert.equal((await post(dm("m1"))).status, 200);
  assert.equal((await post(comment("c1"))).status, 200);
  const r = await (await pull()).json();
  assert.equal(r.events.length, 2);
  assert.deepEqual(
    r.events.map((e: { kind: string; from: string; ref?: string }) => [e.kind, e.from, e.ref]),
    [["dm", "CUST1", undefined], ["comment", "CUST2", "MEDIA9"]]
  );
  assert.equal(r.next, 2);
  assert.equal(typeof r.epoch, "string");
  assert.equal((await (await pull()).json()).epoch, r.epoch); // stable between calls
  const other = make();
  assert.notEqual((await (await other.pull()).json()).epoch, r.epoch); // a different queue has a different epoch
});

test("webhook: a retried delivery is not queued twice", async () => {
  const { post, pull } = make();
  await post(dm("same"));
  const again = await (await post(dm("same"))).json();
  assert.equal(again.new, 0);
  assert.equal((await (await pull()).json()).events.length, 1);
});

test("parse: drops echoes, read receipts, our own messages and reactions", () => {
  const events = parseWebhook({
    entry: [{
      id: "BIZ1",
      messaging: [
        { sender: { id: "BIZ1" }, recipient: { id: "C" }, message: { mid: "e1", text: "hi", is_echo: true } },
        { sender: { id: "C" }, recipient: { id: "BIZ1" }, read: { mid: "r" } },
        { sender: { id: "C" }, recipient: { id: "BIZ1" }, reaction: { mid: "x", action: "react" } },
        { sender: { id: "BIZ1" }, recipient: { id: "BIZ1" }, message: { mid: "self", text: "x" } },
      ],
      changes: [{ field: "comments", value: { id: "own", text: "thanks!", from: { id: "BIZ1" }, media: { id: "M" } } }],
    }],
  }, 5);
  assert.deepEqual(events, []);
});

test("parse: story replies, story mentions and postbacks", () => {
  const events = parseWebhook({
    entry: [{
      id: "BIZ1",
      messaging: [
        { sender: { id: "C" }, recipient: { id: "BIZ1" }, message: { mid: "s1", text: "love it", reply_to: { story: { id: "ST1" } } } },
        { sender: { id: "C" }, recipient: { id: "BIZ1" }, message: { mid: "s2", attachments: [{ type: "story_mention" }] } },
        { sender: { id: "C" }, recipient: { id: "BIZ1" }, timestamp: 9, postback: { payload: "SIZE_7" } },
      ],
    }],
  }, 5);
  assert.deepEqual(events.map((e) => [e.kind, e.ref]), [["story_reply", "ST1"], ["story_mention", undefined], ["postback", undefined]]);
});

test("parse: junk payloads never throw", () => {
  for (const junk of [null, 5, "x", [], {}, { entry: "x" }, { entry: [null, 3, { messaging: "x", changes: 7 }] }]) {
    assert.doesNotThrow(() => parseWebhook(junk, 1));
  }
});

test("pull: needs the token, supports a cursor and a limit", async () => {
  const { post, pull, relay } = make();
  assert.equal((await pull(0, null)).status, 401);
  assert.equal((await pull(0, "wrong")).status, 401);
  for (const id of ["a", "b", "c"]) await post(dm(id));
  const after1 = await (await pull(1)).json();
  assert.deepEqual(after1.events.map((e: { id: string }) => e.id), ["b", "c"]);
  const limited = await (await relay(new Request("https://relay.test/events?limit=1", { headers: { authorization: `Bearer ${PULL}` } }))).json();
  assert.equal(limited.events.length, 1);
});

test("handshake: right token returns the challenge, wrong token is refused", async () => {
  const { relay } = make();
  const ok = await relay(new Request(`https://relay.test/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "12345");
  const bad = await relay(new Request("https://relay.test/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
  assert.equal(bad.status, 403);
});

test("fails closed when not configured", async () => {
  const relay = createRelay({ appSecrets: [], verifyToken: "", pullToken: "", store: new MemoryStore() });
  assert.equal((await relay(new Request("https://relay.test/events"))).status, 503);
  assert.equal((await relay(new Request("https://relay.test/webhook", { method: "POST", body: "{}" }))).status, 503);
});

test("oversized bodies and bad JSON are refused", async () => {
  const { post } = make(new MemoryStore(), { maxBodyBytes: 100 });
  assert.equal((await post("x".repeat(500))).status, 413);
  const { post: post2 } = make();
  assert.equal((await post2("not json")).status, 400);
});

test("a storage failure returns 500 so Meta retries", async () => {
  const broken = { add: async () => { throw new Error("disk full"); }, list: async () => [], prune: async () => {} };
  const { post } = make(broken as unknown as MemoryStore);
  assert.equal((await post(dm("m1"))).status, 500);
});

test("sqlite store: dedupes, orders, survives reopen, prunes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efj-relay-"));
  const file = path.join(dir, "e.db");
  try {
    let s = new SqliteStore(file);
    const e = (id: string) => ({ id, kind: "dm" as const, account: "B", from: "C", text: id, at: 1 });
    assert.equal(await s.add([e("a"), e("b"), e("a")]), 2);
    assert.equal(await s.add([e("b"), e("c")]), 1);
    const epoch = await s.epoch();
    s.close();
    s = new SqliteStore(file); // reopen
    assert.equal(await s.epoch(), epoch); // survives a restart
    assert.deepEqual((await s.list(0, 10)).map((x) => x.id), ["a", "b", "c"]);
    assert.deepEqual((await s.list(2, 10)).map((x) => x.id), ["c"]);
    await s.prune(Date.now() + 1000);
    assert.deepEqual(await s.list(0, 10), []);
    s.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
