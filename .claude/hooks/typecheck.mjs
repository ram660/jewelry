// Stop hook. If TypeScript files changed since the last commit, run the type check. A failure sends Claude back
// to fix it (exit 2), at most once per stop so it cannot loop forever.
import fs from "node:fs";
import { execSync, spawnSync } from "node:child_process";

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { /* ignore */ }
if (input.stop_hook_active) process.exit(0);

let changed = "";
try { changed = execSync("git status --porcelain -- src next.config.ts tsconfig.json package.json", { encoding: "utf8" }); } catch { process.exit(0); }
if (!/\.(ts|tsx|json)\b/.test(changed)) process.exit(0);
if (!fs.existsSync("node_modules/typescript")) process.exit(0);

const r = spawnSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", shell: true });
if (r.status !== 0) {
  console.error("Type check failed. Fix these errors before finishing:\n" + (r.stdout + r.stderr).split("\n").slice(0, 40).join("\n"));
  process.exit(2);
}
process.exit(0);
