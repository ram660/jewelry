import { randomBytes } from "node:crypto";

/**
 * Long-running work started from the Instagram page (making a kit, building a Reel, publishing), kept in memory so the page
 * can poll for progress. Kept on globalThis so a dev-server reload doesn't lose a job that is still running. Server-only.
 */

export type JobKind = "kit" | "regen" | "reel" | "publish" | "ai";

export interface Job {
  id: string;
  kind: JobKind;
  slug: string;
  state: "running" | "done" | "failed";
  lines: string[];
  error?: string;
  result?: unknown;
  started: number;
  ended?: number;
}

export interface JobContext {
  log: (line: string) => void;
  /** Sets what the page shows as the result, also when the job then fails part way (for example the Story after the post). */
  setResult: (r: unknown) => void;
}

const MAX_LINES = 400;
const store: Map<string, Job> = ((globalThis as { __efjJobs?: Map<string, Job> }).__efjJobs ??= new Map());

export const getJob = (id: string) => store.get(id) ?? null;

/** The job of this kind still running for this kit, if any. */
export const runningJob = (slug: string, kind: JobKind) =>
  [...store.values()].find((j) => j.slug === slug && j.kind === kind && j.state === "running") ?? null;

export function startJob(kind: JobKind, slug: string, run: (ctx: JobContext) => Promise<unknown>): Job {
  // Old finished jobs go after an hour.
  for (const [id, j] of store) if (j.ended && Date.now() - j.ended > 3_600_000) store.delete(id);
  const job: Job = { id: randomBytes(8).toString("hex"), kind, slug, state: "running", lines: [], started: Date.now() };
  store.set(job.id, job);
  const ctx: JobContext = {
    log: (line) => {
      job.lines.push(line);
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    },
    setResult: (r) => (job.result = r),
  };
  run(ctx).then(
    (r) => {
      if (r !== undefined) job.result = r;
      job.state = "done";
      job.ended = Date.now();
    },
    (e: unknown) => {
      job.error = e instanceof Error ? e.message : String(e);
      job.state = "failed";
      job.ended = Date.now();
    }
  );
  return job;
}
