import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Finds a command-line tool the Studio runs (cloudflared, ffmpeg). winget installs them under
 * %LOCALAPPDATA%\Microsoft\WinGet\Packages, which a shell opened before the install doesn't have on its PATH yet.
 * An env var (CLOUDFLARED, FFMPEG_PATH) wins. Server-only (Node).
 */
const cache = new Map<string, string | null>();

const runs = (exe: string, flag: string) => {
  try {
    return spawnSync(exe, [flag], { stdio: "ignore", timeout: 10_000, windowsHide: true }).error === undefined;
  } catch {
    return false;
  }
};

/** Search depth under a winget package folder: ffmpeg sits in <pkg>/<build>/bin/ffmpeg.exe. */
function findIn(dir: string, file: string, depth: number): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === file) return path.join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findIn(path.join(dir, e.name), file, depth - 1);
    if (hit) return hit;
  }
  return null;
}

export function findTool(name: "cloudflared" | "ffmpeg", wingetId: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const envVar = name === "ffmpeg" ? "FFMPEG_PATH" : "CLOUDFLARED";
  let found: string | null = process.env[envVar] || null;
  if (!found && runs(name, name === "ffmpeg" ? "-version" : "--version")) found = name;
  if (!found && process.platform === "win32") {
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Packages");
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(pkgs).filter((d) => d.toLowerCase().startsWith(wingetId.toLowerCase())); } catch { /* winget never used */ }
    for (const d of dirs) {
      const hit = findIn(path.join(pkgs, d), `${name}.exe`, 3);
      if (hit) { found = hit; break; }
    }
  }
  // Only remember a hit, so installing the tool while the Studio runs works without a restart.
  if (found) cache.set(name, found);
  return found;
}
