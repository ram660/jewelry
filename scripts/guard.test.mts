// Regression tests for .claude/hooks/guard.mjs (the safety hook that protects secrets, the catalog and raw photos).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BS = String.fromCharCode(92);
const root = process.cwd();
const winRoot = root.split("/").join(BS);

function run(tool_name: string, tool_input: object) {
  const r = spawnSync("node", [".claude/hooks/guard.mjs"], {
    input: JSON.stringify({ tool_name, tool_input, cwd: root }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return r.status;
}
const file = (tool: string, rel: string) => run(tool, { file_path: path.join(root, rel) });
const bash = (command: string) => run("Bash", { command });

test("secrets are blocked, the example file is not", () => {
  assert.equal(file("Read", ".env.local"), 2);
  assert.equal(file("Edit", ".env"), 2);
  assert.equal(file("Read", ".env.example"), 0);
  assert.equal(file("Write", ".env.example"), 0);
  assert.equal(bash("cat .env.local"), 2);
  assert.equal(bash("cat .env.example"), 0);
});

test("the live catalog and build output are protected", () => {
  assert.equal(file("Write", "data/uploads/a.jpg"), 2);
  assert.equal(file("Read", "data/efj.db"), 2);
  assert.equal(file("Write", ".next/x.js"), 2);
  assert.equal(bash("cat data/efj.db"), 2);
  assert.equal(bash("rm -rf data/uploads"), 2);
});

test("the owner's raw photos are read-only, except the two files the skill writes", () => {
  assert.equal(file("Write", "inbox/ring1.jpg"), 2);
  assert.equal(file("Write", "samples/x.png"), 2);
  assert.equal(run("Write", { file_path: "inbox/ring1.jpg" }), 2); // relative path
  assert.equal(file("Write", "inbox/.work/3.json"), 0);
  assert.equal(file("Write", "inbox/.imported.json"), 0);
});

test("code folders that merely share a name are ordinary code", () => {
  assert.equal(file("Write", "src/app/api/inbox/route.ts"), 0);
  assert.equal(file("Write", "src/app/inbox/page.tsx"), 0);
  assert.equal(file("Write", "src/lib/inbox.ts"), 0);
  assert.equal(file("Write", "src/lib/data/helper.ts"), 0);
  assert.equal(file("Edit", "relay/relay.ts"), 0);
});

test("Windows-style absolute paths are understood", () => {
  assert.equal(run("Write", { file_path: `${winRoot}${BS}inbox${BS}a.jpg` }), 2);
  assert.equal(run("Write", { file_path: `${winRoot}${BS}src${BS}app${BS}api${BS}inbox${BS}route.ts` }), 0);
  assert.equal(run("Read", { file_path: `${winRoot}${BS}.env.local` }), 2);
});

test("a path outside the project is not subject to the folder rules, but secrets still are", () => {
  assert.equal(run("Write", { file_path: `C:${BS}elsewhere${BS}inbox${BS}a.jpg` }), 0);
  assert.equal(run("Read", { file_path: `C:${BS}elsewhere${BS}.env.local` }), 2);
});

test("destructive commands are blocked, normal ones are not", () => {
  assert.equal(bash("git reset --hard HEAD"), 2);
  assert.equal(bash("git push --force origin main"), 2);
  assert.equal(bash("node scripts/efj.mjs list"), 0);
  assert.equal(bash("npm run typecheck"), 0);
  assert.equal(run("Glob", { pattern: "**/*.ts" }), 0);
});
