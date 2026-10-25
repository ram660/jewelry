// PreToolUse guard. Reads the tool call as JSON on stdin; exit code 2 blocks it and tells Claude why.
// Blocks: secrets (.env*), the live catalog (data/), the owner's raw photos (inbox/, samples/) being read into
// context by shell commands, and destructive git/shell commands. Allows scripts/efj.mjs and .env.example.
import fs from "node:fs";

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }

const tool = input.tool_name ?? "";
const args = input.tool_input ?? {};
const norm = (s) => String(s ?? "").split(String.fromCharCode(92)).join("/");

const SECRET = /(^|\/)\.env(\.(?!example\b)[\w.-]+)?$/i; // .env, .env.local, but not .env.example
// Folder rules apply to the project's own top-level folders only, so code such as src/app/api/inbox/ is ordinary code.
const PROTECTED_DIR = /^(data|\.next)\/./i;
const RAW_PHOTOS = /^(inbox|samples)\//i;
const WRITABLE_INBOX = /^inbox\/(\.imported\.json|\.work\/)/i;
const root = norm(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()).replace(/\/+$/, "").toLowerCase();
/** The path relative to the project root, or null when it points outside the project. */
function projectRelative(p) {
  const lower = p.toLowerCase();
  if (lower.startsWith(root + "/")) return p.slice(root.length + 1);
  if (/^[a-z]:\//i.test(p) || p.startsWith("/")) return null;
  return p.replace(/^\.\//, "");
}

function block(reason) {
  console.error(`Blocked by .claude/hooks/guard.mjs: ${reason}`);
  process.exit(2);
}

if (["Read", "Edit", "Write"].includes(tool)) {
  const p = norm(args.file_path);
  if (SECRET.test(p)) block("secrets file. Ask the owner to edit .env.local themselves; use .env.example for documentation.");
  const rel = projectRelative(p);
  if (rel !== null) {
    if (tool !== "Read" && PROTECTED_DIR.test(rel)) block("generated or live data folder (data/, .next/). Change code or use scripts/efj.mjs instead.");
    if (tool === "Read" && /^data\/efj\.db/i.test(rel)) block("the SQLite database is binary and private. Use: node scripts/efj.mjs show <id>.");
    if (tool !== "Read" && RAW_PHOTOS.test(rel) && !WRITABLE_INBOX.test(rel)) {
      block("the owner's raw photos are read-only. Only inbox/.imported.json and inbox/.work/ may be written.");
    }
  }
}

if (["Glob", "Grep"].includes(tool)) {
  const p = norm(args.path) + " " + norm(args.pattern) + " " + norm(args.glob);
  if (/\.env\.local|\.env(\s|$)/.test(p)) block("do not search secrets files.");
}

if (tool === "Bash") {
  const c = norm(args.command);
  if (/(^|[\s"'=<>|;&(])\.?\/?\.env(\.(?!example)[\w.-]+)?(?=$|[\s"'|;&)])/.test(c) && !/\.env\.example/.test(c)) {
    block("command touches a .env secrets file.");
  }
  if (/\b(cat|type|less|more|head|tail|Get-Content|gc|sqlite3|strings)\b[^|;&]*\bdata\/efj\.db/i.test(c)) block("do not dump the database. Use scripts/efj.mjs.");
  if (/\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)\b[^;&|]*(data|inbox|samples|\.git|\.claude)(\/|\s|$)/i.test(c)) block("destructive delete of a protected folder.");
  if (/\bgit\s+(push\s+.*(--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.)/i.test(c)) block("destructive git command. Ask the owner first.");
  if (/Remove-Item[^;&|]*-Recurse[^;&|]*(data|inbox|samples)\b/i.test(c)) block("destructive delete of a protected folder.");
}

process.exit(0);
