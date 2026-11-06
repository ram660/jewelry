// Free stock photos and videos for education and mood posts (not product photos). See .claude/skills/stock-images.
//
//   npm run stock -- scripts/stock-themes.txt
//   npm run stock -- "https://pixabay.com/images/search/pearl%20earrings/" --theme 07_pearls --max 30
//
// A themes file has one line per search:  theme_folder | link   or   theme_folder | pixabay: pearl earrings
// Sites: pexels, pixabay, unsplash (add " videos" for Reels B-roll, e.g. "pexels videos: putting on necklace").
// Options: --out <folder> (default stock/)  --max <n> per line (default 40)  --theme <name> for bare links
//          --must "word,word"  keep only results whose description mentions one of the words
//          --workers <n> parallel downloads (default 2; more makes Pixabay throttle)
//          --allow-ai  also keep results tagged as AI-generated (skipped by default)
// Files land in <out>/<theme>/<site>_<id>.<ext>; credits.csv records author, page and licence for every file.
// Re-running skips files already downloaded, so a rate-limited run can simply be repeated later.
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";

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

const { parseStockLink, searchLink, findStock, downloadStock, mentionsAny, isAiGenerated, KEY_NAMES } = await import(
  "../src/lib/providers/stock.ts"
);
type StockItem = import("../src/lib/providers/stock.ts").StockItem;
type StockSite = import("../src/lib/providers/stock.ts").StockSite;

try {
  process.loadEnvFile(".env.local"); // the keys; never printed
} catch {
  // no .env.local: keys may come from the shell
}

// ---- arguments
const argv = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1] ?? fallback;
  argv.splice(i, 2);
  return v;
};
const outDir = path.resolve(opt("out", "stock"));
const max = Math.max(1, Number(opt("max", "40")) || 40);
const workers = Math.max(1, Math.min(8, Number(opt("workers", "2")) || 2));
const defaultTheme = opt("theme", "");
const allowAi = argv.includes("--allow-ai");
if (allowAi) argv.splice(argv.indexOf("--allow-ai"), 1);
const must = opt("must", "").split(",").map((w) => w.trim()).filter(Boolean);
if (!argv.length) {
  console.log("Usage: npm run stock -- <themes file | link> [--max 40] [--theme name] [--must words] [--out stock]");
  process.exit(1);
}

const SAFE_THEME = /^[\w-]{1,60}$/;
const entries: { theme: string; link: string }[] = [];
for (const arg of argv) {
  const lines = /^https?:\/\//i.test(arg) ? [arg] : fs.readFileSync(arg, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const bar = line.indexOf("|");
    const theme = (bar >= 0 ? line.slice(0, bar).trim() : defaultTheme) || "unsorted";
    let target = bar >= 0 ? line.slice(bar + 1).trim() : line;
    const short = target.match(/^(pexels|pixabay|unsplash)( videos)?\s*:\s*(.+)$/i);
    if (short) target = searchLink(short[1].toLowerCase() as StockSite, short[3], short[2] ? "video" : "image");
    if (!SAFE_THEME.test(theme)) {
      console.log(`[skip] theme "${theme}": use letters, numbers, _ and - only`);
      continue;
    }
    entries.push({ theme, link: target });
  }
}

// ---- find
type Job = StockItem & { theme: string };
const jobs: Job[] = [];
const seen = new Set<string>();
const missingKeys = new Set<string>();
for (const { theme, link } of entries) {
  const parsed = parseStockLink(link);
  if (!parsed) {
    console.log(`[skip] not a Pexels / Pixabay / Unsplash photo, video, search or collection link: ${link}`);
    continue;
  }
  if (!process.env[KEY_NAMES[parsed.site as StockSite]]) {
    missingKeys.add(KEY_NAMES[parsed.site as StockSite]);
    continue;
  }
  try {
    const found = (await findStock(parsed, max)).filter(
      (i: StockItem) => mentionsAny(i.description, must) && (allowAi || !isAiGenerated(i))
    );
    const fresh = found.filter((i: StockItem) => !seen.has(`${i.site}_${i.id}`));
    fresh.forEach((i: StockItem) => seen.add(`${i.site}_${i.id}`));
    jobs.push(...fresh.map((i: StockItem) => ({ ...i, theme })));
    console.log(`[found ${String(fresh.length).padStart(4)}] ${theme}  ${link}`);
  } catch (e) {
    console.log(`[skip] ${link}\n       ${(e as Error).message}`);
  }
}
for (const k of missingKeys) console.log(`[skip] links for this site need ${k} in .env.local (free key, see .env.example)`);

// ---- download
fs.mkdirSync(outDir, { recursive: true });
const creditsPath = path.join(outDir, "credits.csv");
const csv = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
if (!fs.existsSync(creditsPath)) {
  fs.writeFileSync(creditsPath, "file,theme,site,media,id,author,description,page_url,licence\n");
}
const write = async (dest: string, data: Uint8Array) => {
  await fs.promises.writeFile(`${dest}.part`, data);
  await fs.promises.rename(`${dest}.part`, dest);
};

let saved = 0, existing = 0, failed = 0, done = 0;
const queue = [...jobs];
console.log(`\nDownloading ${jobs.length} files to ${outDir}`);
await Promise.all(
  Array.from({ length: workers }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const rel = path.join(job.theme, `${job.site}_${job.id}.${job.ext}`);
      const dest = path.join(outDir, rel);
      let status = "ok";
      if (fs.existsSync(dest)) {
        existing++;
        status = "exists";
      } else {
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          await downloadStock(job, dest, write);
          fs.appendFileSync(creditsPath, [rel.split(path.sep).join("/"), job.theme, job.site, job.media, job.id, job.author,
            job.description, job.pageUrl, job.licence].map(csv).join(",") + "\n");
          saved++;
        } catch (e) {
          failed++;
          status = `error: ${(e as Error).message}`;
        }
      }
      console.log(`  [${++done}/${jobs.length}] ${status.padEnd(7)} ${rel}`);
    }
  })
);
console.log(`\nDone: ${saved} new, ${existing} already there, ${failed} failed. Credits: ${creditsPath}`);
