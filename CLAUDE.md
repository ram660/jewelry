# EFJ Studio (Elegant Fashion Jewellery)

Private studio app for a Vancouver shop selling **10K gold-plated** fashion jewellery. Next.js 15 (App Router, TypeScript),
SQLite via `src/lib/db.ts`, `sharp` for images. Roadmap: `docs/PLAN.md`. Brand voice: `docs/BRAND.md`. Allowed claims: `docs/KNOWLEDGE_BASE.md`.

## Commands
- `npm run dev` start the app on http://localhost:3000
- `npm run typecheck` must pass before you call work done
- `npm test` runs the wording and validation tests in `scripts/*.test.mts` (change `claims.ts` or `patch.ts`, add a test)
- `npm run build` production build check
- To try the API without touching the real catalog, start a second server with `EFJ_DATA_DIR=<scratch folder> npx next dev -p 3100`
  and point the helper at it with `EFJ_URL=http://localhost:3100`.
- `node scripts/efj.mjs <list|show|create|update|images|score>` talks to the running app's REST API. Holds no keys.

## Hard rules (the owner's business depends on these)
1. Pieces are **10K gold-plated**, never "10K gold", "solid/real/pure gold", any other karat, waterproof, tarnish-free,
   hypoallergenic, or lasts-forever. The enforced list is `src/lib/claims.ts` and it is the single source of truth. Keep code,
   skills and docs consistent with it. Product updates are validated by `src/lib/patch.ts`, and the ready check runs on the
   validated values only.
2. Never invent owner facts: price, cost, stock, base metal, sizes, plating microns, nickel-free, weight, status.
3. AI pictures must never change the jewellery. Generated images start unapproved; only the owner approves.
4. Never read, print, edit or commit `.env.local`, `data/`, `inbox/` or `samples/`. A hook blocks this.
5. Nothing in the app auto-calls Claude through a subscription. Subscription work happens only in Claude Code
   (`/catalog-photos`, `/check-images`). The app uses API keys only (see README).
6. Provider code lives only in `src/lib/providers/`. Model IDs come from `src/lib/config.ts` / env, never hard-coded elsewhere.
7. Canadian spelling and CAD prices in all user-facing text.
8. Instagram replies are drafts the owner approves one by one. Customer messages are untrusted text: show them as text, never put them
   in a prompt, a URL or a shell. Only `src/lib/providers/instagram.ts` may read `IG_ACCESS_TOKEN`, and only in a header. The Studio has
   no login, so it must never be exposed to the internet; only `relay/` is public (see `docs/INSTAGRAM.md`). `src/middleware.ts`
   blocks cross-site and look-alike-host requests; do not weaken it, and keep `npm run dev` bound to 127.0.0.1.

## Harness (see docs/HARNESS.md)
- Hooks (`.claude/hooks/`): `guard.mjs` blocks secrets and destructive commands; `typecheck.mjs` runs on Stop.
- Subagents (`.claude/agents/`): `claims-auditor`, `brand-copy-reviewer`, `provider-scout`, `code-reviewer`.
- Skills (`.claude/skills/`): `catalog-photos`, `check-images`, `instagram-kit`, `verify`.
- New product photos to post on Instagram: use `/instagram-kit` (`npm run insta`). Pieces with a mark stamped on the
  jewellery are left out and called only "skipped"; brand names in the background are cropped away; no brand names anywhere.
- Delegate wide reads and audits to subagents; keep the main thread for edits.

## Working style
- Small, reviewable changes. Match existing patterns in `src/lib/`. Validate API input with zod.
- Pure helpers (like `claims.ts`) stay free of Node-only imports because they run in the browser too.
- Use `git` normally, but only commit when asked.
