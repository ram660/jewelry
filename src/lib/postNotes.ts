import { scanHashtag, scanText } from "./claims";

/**
 * Reads the post-notes file that `npm run insta` writes (captions, hashtags, alt text) and checks what would be posted.
 * Pure, so it runs in tests and the browser too.
 */

export interface PostNotes {
  captions: string[];
  hashtags: string;
  alt: { slide1?: string; slide2?: string; story?: string };
}

function section(md: string, heading: RegExp): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

export function parsePostNotes(md: string): PostNotes {
  // Each run of "> " lines under "## Caption" is one caption.
  const captions: string[] = [];
  let current: string[] | null = null;
  for (const line of section(md, /^## Caption/).split("\n")) {
    if (line.startsWith(">")) (current ??= []).push(line.replace(/^> ?/, ""));
    else if (current) captions.push(current.join("\n").trim()), (current = null);
  }
  if (current) captions.push(current.join("\n").trim());

  const tagBlock = section(md, /^## Hashtags/).match(/```[^\n]*\n([\s\S]*?)```/);
  const hashtags = (tagBlock?.[1] ?? "").trim().replace(/\s+/g, " ");

  const alt: PostNotes["alt"] = {};
  for (const m of section(md, /^## Alt text/).matchAll(/^- \*\*(.+?):\*\*\s*(.+)$/gm)) {
    const label = m[1].toLowerCase();
    if (label.includes("story")) alt.story ??= m[2].trim();
    else if (label.includes("2")) alt.slide2 ??= m[2].trim();
    else alt.slide1 ??= m[2].trim();
  }
  return { captions: captions.filter(Boolean), hashtags, alt };
}

/** The caption exactly as it goes to Instagram: the chosen caption, a blank line, then the hashtags. */
export const fullCaption = (caption: string, hashtags: string) => (hashtags ? `${caption}\n\n${hashtags}` : caption);

/** Everything that must be fixed before this text is posted. Empty means it can go. */
export function postProblems(caption: string, altTexts: string[] = []): string[] {
  const problems: string[] = [];
  for (const text of [caption, ...altTexts]) {
    const blanks = text.match(/\[[^\]\n]*\]/g);
    if (blanks) problems.push(`Fill in or remove: ${[...new Set(blanks)].join(", ")}`);
  }
  problems.push(...scanText([caption, ...altTexts].join("\n")));
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  for (const t of tags) problems.push(...scanHashtag(t).map((m) => `${t}: ${m}`));
  if (tags.length > 30) problems.push(`Instagram allows 30 hashtags; this has ${tags.length}.`);
  if (caption.length > 2200) problems.push(`Instagram captions are limited to 2,200 characters; this has ${caption.length}.`);
  for (const a of altTexts) if (a.length > 1000) problems.push("Alt text is limited to 1,000 characters.");
  return [...new Set(problems)];
}
