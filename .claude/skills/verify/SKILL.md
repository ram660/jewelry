---
name: verify
description: Run the full verification pass for EFJ Studio (type check, build, banned-claims scan of customer-facing text) and report pass or fail. Use before saying work is finished or before committing.
allowed-tools: Read Grep Glob Bash(npm run typecheck) Bash(npm run build) Agent
---
1. `npm run typecheck`. Fix every error before continuing.
2. `npm run build`. If a dev server is running on port 3000 and the build clashes with `.next/`, tell the owner rather than killing it.
3. Use the `claims-auditor` subagent on any text you changed (docs, presets, prompts, UI strings, skills).
4. If `src/` changed, use the `code-reviewer` subagent.
5. Report one line per step: PASS, FAIL (with the first error) or SKIPPED (with why). Do not claim success for a step you did not run.
