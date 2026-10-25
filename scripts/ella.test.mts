import test from "node:test";
import assert from "node:assert/strict";
import { classify, draftReplies, findProduct } from "../src/lib/ella.ts";
import { scanText } from "../src/lib/claims.ts";
import { planSend } from "../src/lib/sendrules.ts";

const ring = {
  name: "Aria Ring", price_cad: 34, sizes: "6, 7, 8", base_metal: "", nickel_free: null as boolean | null,
  hypoallergenic: null as boolean | null, stock_qty: 5, low_stock_at: 3, status: "ready" as const,
};
const dm = (text: string, product: typeof ring | null = ring) => draftReplies({ text, kind: "dm", product });
const only = (r: ReturnType<typeof dm>) => r.drafts.map((d) => d.text).join(" | ");

test("classifies common questions", () => {
  assert.deepEqual(classify("How much is this?"), ["price"]);
  assert.deepEqual(classify("✨"), ["price"]);
  assert.ok(classify("what sizes do you have").includes("size"));
  assert.ok(classify("is it real gold?").includes("material"));
  assert.ok(classify("can I wear it in the shower").includes("water"));
  assert.ok(classify("will it tarnish").includes("tarnish"));
  assert.ok(classify("will it turn my finger green").includes("green"));
  assert.ok(!classify("will it turn my finger green").includes("size"));
  assert.ok(classify("do you ship to the US").includes("shipping"));
  assert.ok(!classify("how long will it last").includes("shipping"));
  assert.ok(classify("how long will it take to arrive").includes("shipping"));
  assert.deepEqual(classify("how much is shipping to Toronto"), ["shipping"]);
  assert.ok(classify("price of the ring and do you ship").includes("price"));
  assert.ok(classify("I'll take it").includes("order"));
  assert.deepEqual(classify("   "), ["unknown"]);
  assert.deepEqual(classify("hello"), ["greeting"]);
});

test("price, size and stock come from the product record only", () => {
  assert.match(only(dm("how much")), /\$34 CAD, 10K gold-plated/);
  assert.match(only(dm("what sizes")), /6, 7, 8/);
  assert.match(only(dm("is it available")), /available/);
  assert.match(only(dm("is it available", { ...ring, stock_qty: 2 })), /Only 2 left/);
  const noPrice = dm("how much", { ...ring, price_cad: null });
  assert.equal(noPrice.needsOwner, true);
  assert.doesNotMatch(only(noPrice), /\$/);
  const noSizes = dm("what sizes", { ...ring, sizes: "" });
  assert.equal(noSizes.needsOwner, true);
});

test("with no product it asks which piece, and invents nothing", () => {
  const r = dm("how much is it", null);
  assert.match(only(r), /Which piece/);
  assert.doesNotMatch(only(r), /\$\d/);
});

test("owner decisions are never answered, only held", () => {
  for (const q of ["do you ship to Toronto", "can I get a discount", "I'll take it", "do you do engraving", "what is your return policy"]) {
    const r = dm(q);
    assert.equal(r.needsOwner, true, q);
    assert.match(only(r), /owner/, q);
    assert.doesNotMatch(only(r), /\b(days?|free shipping|\$\d+ off|refund)\b/i, q);
  }
});

test("complaints and skin reactions go to the owner with an apology only", () => {
  for (const q of ["I got a rash from it", "I want a refund", "my order arrived damaged", "my skin is itchy and swollen"]) {
    const r = dm(q);
    assert.equal(r.needsOwner, true, q);
    assert.match(only(r), /so sorry/, q);
    assert.doesNotMatch(only(r), /\$|available|sizes/, q);
  }
});

test("skin questions use only confirmed facts", () => {
  assert.equal(dm("is it ok for sensitive skin").needsOwner, true);
  const ok = dm("is it ok for sensitive skin", { ...ring, nickel_free: true });
  assert.equal(ok.needsOwner, false);
  assert.match(only(ok), /nickel-free/);
});

test("the material answer says plainly it is not solid gold, and uses the base metal only when known", () => {
  const a = only(dm("is it real gold?"));
  assert.match(a, /10K gold-plated/);
  assert.match(a, /not solid gold/);
  assert.doesNotMatch(a, /real gold|genuine/i);
  assert.match(only(dm("what is it made of", { ...ring, base_metal: "brass" })), /over brass/);
  assert.doesNotMatch(a, /over /);
});

test("asked if she is a bot or a real person, she says she is the virtual assistant", () => {
  for (const q of ["are you a bot?", "are you a real person?", "are you human"]) {
    assert.match(only(dm(q)), /virtual assistant/, q);
    assert.equal(dm(q).needsOwner, false, q);
  }
  const person = dm("can I talk to a real person");
  assert.equal(person.needsOwner, true);
  assert.doesNotMatch(only(person), /virtual assistant/);
});

test("a holding reply never says 'the rest' when nothing was answered", () => {
  assert.doesNotMatch(only(dm("do you ship to Toronto")), /the rest/);
  assert.match(only(dm("how much, and do you ship?")), /checking the rest/);
});

test("comments: public reply plus private answer; complaints get no public reply", () => {
  const price = draftReplies({ text: "price?", kind: "comment", product: ring });
  assert.deepEqual(price.drafts.map((d) => d.channel), ["comment_public", "comment_private"]);
  assert.equal(price.drafts[0].text, "Sent you a DM 💛");
  assert.match(price.drafts[1].text, /\$34 CAD/);
  const bad = draftReplies({ text: "this broke after one day, refund please", kind: "comment", product: ring });
  assert.deepEqual(bad.drafts.map((d) => d.channel), ["comment_private"]);
  assert.equal(bad.needsOwner, true);
  const praise = draftReplies({ text: "so beautiful 😍", kind: "comment", product: ring });
  assert.deepEqual(praise.drafts.map((d) => d.channel), ["comment_public"]);
  const unclear = draftReplies({ text: "hmm ok", kind: "comment", product: ring });
  assert.deepEqual(unclear.drafts, []);
  assert.equal(unclear.needsOwner, true);
});

test("a product name with banned wording cannot leak into a draft", () => {
  const r = dm("how much", { ...ring, name: "Solid Gold Ring" });
  assert.equal(r.needsOwner, true);
  assert.doesNotMatch(only(r), /solid gold/i);
});

test("every draft the writer can produce passes the claims scanner", () => {
  const questions = [
    "how much", "what sizes", "real gold?", "waterproof?", "will it tarnish", "green finger?", "how do I clean it",
    "in stock?", "are you a bot", "hi", "love it", "sensitive skin?", "do you ship", "discount?", "I'll take it",
    "refund", "talk to a person", "asdf",
  ];
  for (const q of questions) {
    for (const kind of ["dm", "comment"] as const) {
      const r = draftReplies({ text: q, kind, product: { ...ring, nickel_free: true } });
      for (const d of r.drafts) assert.deepEqual(scanText(d.text, { nickel_free: true }), [], `${kind}: ${q} -> ${d.text}`);
      const emojis = r.drafts.flatMap((d) => d.text.match(/[\u{1F300}-\u{1FAFF}✨]/gu) ?? []);
      for (const d of r.drafts) assert.ok((d.text.match(/[\u{1F300}-\u{1FAFF}✨]/gu) ?? []).length <= 2, d.text);
      assert.ok(emojis.every((e) => ["💛", "✨", "🤍", "🎁", "📦", "🌿"].includes(e)), q);
    }
  }
});

test("findProduct matches an SKU or the longest unique name", () => {
  const list = [
    { id: 1, name: "Aria Ring", sku: "EFJ-RG-0001" },
    { id: 2, name: "Aria Ring Wide", sku: "EFJ-RG-0002" },
    { id: 3, name: "Luna", sku: "EFJ-ER-0003" },
  ];
  assert.equal(findProduct("price for efj-rg-0001?", list), 1);
  assert.equal(findProduct("how much is the Aria Ring Wide", list), 2);
  assert.equal(findProduct("how much is the aria ring", list), 1);
  assert.equal(findProduct("do you have luna in stock", list), 3);
  assert.equal(findProduct("what do you sell", list), null);
  assert.equal(findProduct("anything", [{ id: 9, name: "ab", sku: "x" }]), null);
});

test("send plan follows Instagram's rules", () => {
  const base = { channel: "dm" as const, source: "relay" as const, eventAt: 1_000_000, now: 1_000_000 + 3600_000, mode: "live" as const, hasToken: true, privateAlreadySent: false };
  assert.equal(planSend(base).how, "api");
  assert.equal(planSend({ ...base, mode: "off" }).how, "copy");
  assert.equal(planSend({ ...base, source: "manual" }).how, "copy");
  assert.equal(planSend({ ...base, hasToken: false }).how, "blocked");
  assert.equal(planSend({ ...base, now: base.eventAt + 25 * 3600_000 }).how, "blocked");
  assert.equal(planSend({ ...base, channel: "comment_private", now: base.eventAt + 25 * 3600_000 }).how, "api");
  assert.equal(planSend({ ...base, channel: "comment_private", now: base.eventAt + 8 * 24 * 3600_000 }).how, "blocked");
  assert.equal(planSend({ ...base, channel: "comment_private", privateAlreadySent: true }).how, "blocked");
  assert.equal(planSend({ ...base, channel: "comment_public", now: base.eventAt + 30 * 24 * 3600_000 }).how, "api");
});
