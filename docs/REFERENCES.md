# Outside repos and tools reviewed

Reviewed 24 Oct 2026 from each project's own GitHub page. Stars and licences change, so recheck before depending on anything.
"Verified" means read on the repo page; "not verified" means I could not confirm it.

## Adopt or borrow

### ayuuxh2/insta-p8 (MIT, Next.js 16 + Supabase, about 158 stars)
Self-hosted ManyChat alternative. **Best match for Phase 3 and 4**, same stack as this app. I cloned it read-only and read the code.
- **Webhook route** (`app/api/instagram/webhook/route.ts`): GET handshake with verify token, and POST checks Meta's `X-Hub-Signature-256`
  with HMAC-SHA256 and a timing-safe compare. Copy this pattern exactly. Never accept unsigned webhooks.
- **Comment to DM:** public comment reply plus one private DM, with random public reply variants. Matches our Phase 4 plan.
- **Graph API wrapper** (`lib/instagram-api.ts`, v24.0): text, card, media DMs, typing indicator, reactions, comment replies.
- **Schema ideas:** `webhook_events` (de-duplicate retried events), `dm_queue` (delayed sends), `conversations`/`messages`, `content_pool` and
  `scheduler_config` for scheduled posting.
- **Do not copy:** its AI reply prompt tells the model to "never reveal you are AI" and has no claims check. Ours must run every
  reply through `scanText` in `src/lib/claims.ts`, answer only from `KNOWLEDGE_BASE.md`, start in draft-only mode, and not hide that it is automated.
- Not verified: how well it handles Meta's 24-hour window and the `HUMAN_AGENT` tag. Test before relying on it.
- **Decision: borrow patterns, do not merge the repo.** It brings a second database (Supabase), a 900-line webhook file with type checking
  switched off, follow-gate and unlock features we do not want, and an AI prompt that conflicts with our honesty rules.
- **Security blocker for our own app:** no route in EFJ Studio asks for a login, because it only runs on the owner's computer. Instagram needs a
  public webhook address. Exposing this app to the internet would expose the whole catalog, uploads and delete buttons. So Phase 4 must be
  either a small separate public service that only receives webhooks and writes drafts, or the whole app behind a login first.

### ZhengPeng7/BiRefNet (MIT, about 4.3k stars)
**Integrated two ways.** Through fal (`falCutout` in `src/lib/visuals.ts`) at its strongest setting: the "General Use (Heavy)" model,
2048 px, with foreground refinement. And on this computer (`src/lib/localCutout.ts`) using the ONNX builds from
`onnx-community/BiRefNet_lite-ONNX` (MIT): 214 MB, or 109 MB in half precision, and `onnx-community/BiRefNet-ONNX` full model at 467 MB in half precision.
No Python is needed: the Node ONNX runtime plus `sharp` do the work. Install with `node scripts/get-birefnet.mjs lite`.
- **Measured here** (Intel Core Ultra 5, 15 GB, on battery): about 15 to 45 s per photo on the CPU. The Intel Arc graphics path (DirectML) ran out of
  memory with the full-precision model and crashed the graphics driver with the half-precision one, so it is CPU only.
- **Quality:** on a drawn test picture (ring, stone and a dashed chain on a striped background) it cut out all three cleanly, with faint
  remnants between chain links. Not yet judged on real photos. Use `node scripts/cutout-local.mts <photo>` and compare with fal's result.
- **Not tested:** the 467 MB full model (half precision on CPU is likely slower still), and the matting variant.
- Keep BiRefNet instead of RMBG, which is non-commercial.

### Instagram publishing flow
No ready Next.js carousel scheduler turned up. The standard sequence (child container per image, parent CAROUSEL container, then publish, with
public HTTPS image URLs) is documented in Meta's Graph API docs. The n8n node `MookieLian/n8n-nodes-instagram` is a useful reference for it.
insta-p8's `content_pool` and `scheduler_config` tables are a starting point for the calendar.

## Learn from, do not ship
- **lllyasviel/IC-Light** (Apache-2.0 repo, about 8.6k stars): relights a foreground over a new background. Promising for scene realism, but
  relighting can shift gold tone, so any use needs the `/check-images` gate. Its README steers commercial users away from RMBG 1.4 toward BiRefNet.
  Not verified: whether the newer V2 weights carry separate terms. Read the model card first.
- **Camweara** (commercial, not open source): shows what jewellery sellers expect, like cutouts and chain attachment. Not a dependency.

### morluto/rea ("REA", the original) (checked 26 Oct 2026 through GitHub's API, the npm registry and a read-only clone)
Reverse engineering agent tools: one CLI and one MCP server that let a coding agent take apart software. **This is the live project. The fork described further
down is a stale snapshot, so ignore its numbers.**
- **State:** MIT, not archived, created 14 Apr 2026, updated 25 Oct 2026, 5,468 commits, release 6.8.0 on 25 Oct (6.7.0 and 6.6.0 a week earlier). 383,832 stars and
  96,057 forks per GitHub's API, an unusually high count for a six-month-old project that I cannot judge as organic. One maintainer. 1,076 open issues.
- **Targets now covered:** native binaries (Hopper, Ghidra, IDA and others), JavaScript and Electron apps, .NET, Android APKs, **websites** (through a Chrome-family
  browser you control: page structure, scripts, network metadata, bundle analysis, comparing captures), saved HAR or Fiddler captures, firmware, and more.
- **Windows:** partly. Android APK analysis (JADX plus a JDK) works on Windows x64. Native Windows programs are "experimental", need Ghidra 12.1.x and a JDK 21 or newer.
  Several tools are Linux or macOS only.
- **Does not run on this laptop as it stands:** it needs Node 24.22.1 or newer. This machine has 24.11.0.
- **Install-time hook:** only `prepare`, which I read. It does nothing for a normal published install. Dependencies: 42 packages, including `playwright-core`, `node-pty`,
  `openpgp`, and an optional `frida`. The package is 49 MB unpacked.
- **Its own rules:** it will not help circumvent DRM, bypass authentication or bot protection, copy proprietary software or reproduce protected code and assets.
  The README says you are responsible for permission and for the terms of service of whatever you analyse. Its website tool is passive, attaching to a browser you run.
- **Verdict for EFJ Studio: do not install now.** Our own code is open to us, so there is nothing to disassemble. The new website tools could audit our own Studio
  (for example, check what its web bundle exposes), but our tests already cover that. Installing it would add a large, fast-changing dependency tree and a tool that can
  read files and attach to browsers on a machine that holds your secrets. If a specific need comes up, run it from a separate folder with a pinned version.
- **Not worth doing with it:** analysing Instagram's or any competitor's service. Meta's terms forbid automated collection, and copying a competitor's features risks
  both their terms and copyright.

#### The archived fork ChristopheAI/reverseengineeranything (outdated snapshot of v1.2.0, 161 commits, 6 stars, macOS and Linux only)
Studied first by cloning it into a scratch folder and reading the code. Nothing from it was installed or run.
- **What it is:** a command line tool and an MCP server with 68 tools that lets a coding agent take apart an existing application:
  macOS apps, native binaries, Electron, APK, IPA and DMG packages. It uses Hopper Disassembler (a separate paid Mac app). About 27,500 lines of TypeScript.
- **Cannot be used here:** it runs on macOS and some 64-bit Linux only, and this project is a web app on Windows. It explicitly does not recover
  source code or clone an app. For a source-available repo such as insta-p8, reading the code, as we did, is all that is needed.
- **Caution:** it installs a native module on install (node-pty), has a curl installer, and has 6 stars. It is archived, so there will be no fixes.
  Reverse engineering a competitor's closed app can breach its licence terms. Take legal advice before copying anything from one.
- **Ideas worth borrowing:**
  - **Evidence with a confidence label.** Every result records how it is known: observed, derived or inferred, with its limits written down. For us:
    tag AI-written product fields as "AI guess" until the owner confirms them, as already done for price, base metal and nickel-free.
  - **Unknown is never false.** Missing data stays unknown, never "no". We already do this for `nickel_free`, and the owner questions list is the same idea.
  - **Approval before changing anything**, and a setup step that prints what it will do first. Matches how `get-birefnet.mjs` works.
  - **Cheap quality tools:** `knip` finds dead code, `jscpd` finds copied code, a pre-commit hook runs checks. A hook running `npm run typecheck` and `npm test`
    before every commit would be a small, real gain here.

## Skip
- **tryonlabs/opentryon** (CC BY-NC 4.0, about 559 stars): garment try-on, background removal (BEN2), CLI, MCP server and web UI. The licence
  is **non-commercial**, and it does not mention jewellery. Fine for personal experiments, not for the shop.
- **fashn-ai TryOnDiffusion**, **JustTryIt**, **AI Closet**: clothing or live-camera try-on, not product-photo fidelity.

## Claude Code harness references
- **hesreallyhim/awesome-claude-code** (about 56k stars): index of hooks, skills, agents and CLAUDE.md templates. I could only see the repo's
  top level, not individual entries, so browse its README for specific ideas.
- Official docs on subagents and hooks: https://code.claude.com/docs/en/sub-agents
- Community guidance matches what is set up here: keep CLAUDE.md under about 200 lines, push detail into skills, and enforce hard rules with
  hooks. These come from blog posts, so treat them as opinion.

## Meta's AI products (checked 25 Oct 2026, from Meta's own pages unless marked)

Meta's lineup changed completely in 2026, so older advice about Llama is out of date. The newest open Llama is still Llama 4 from April 2025.

| Product | What it is | Cost | Fit for EFJ Studio |
|---|---|---|---|
| **Meta Model API** (`api.meta.ai/v1`, OpenAI and Anthropic compatible) | Hosted Muse models, pay as you go, no minimums | see below | Easy to add as a provider |
| **Muse Spark 1.3** (`muse-spark-1.3`) | Reasoning model, 1M token context | $1.25 in / $4.25 out per 1M tokens | Photo reading and copy, if it accepts images (not confirmed on the pages I read) |
| Muse Spark "contributor" mode | Same model, cheaper at $0.10 / $0.20 | cheapest | **Avoid.** It uses your content to train Meta's future models |
| **Muse Image** (`muse-image-1.0`) | Text-to-image and editing, up to 10 reference photos, up to 1600 px | $0.01 per image, 150 requests a minute | Scenes and on-model shots, with the usual fidelity risk |
| **SAM 3.1** (`sam-3.1`) | Finds objects from a text prompt and returns masks | $2.50 per 1,000 images | Possible cutout alternative, not proven better than BiRefNet |
| Muse Voice Transcribe | Speech to text | $0.18 per hour | Not needed |
| **Muse Glimmer 30B** | Open weights, Apache 2.0, reads text and images | free | Needs 24 to 32 GB of memory. This laptop has 15.5 GB, so it cannot run it |
| **Muse Spark Open** | Open weights, 816B parameters | free | Far too large for any laptop |
| **SAM 3 weights** | Open weights, "SAM License" | free | 3.4 GB, access needs Meta's approval, bigger than the 500 MB rule |
| **DINOv3** | Image feature models, custom licence that allows commercial use | free | Idea: a free local similarity score for the "does the picture match the real piece" check. Untested |
| **Instagram API** | Publishing, comments, messages | no charge per call | Already planned. Needs Meta app review |
| **Meta AI app** (Muse Image) | Consumer chat and image tool | "free for everyday creation" | Manual use only. Limits and terms for commercial use of the pictures are not stated |

What is not certain:
- **Free credits.** Third-party sites say new Model API accounts get $20. Meta's own docs do not mention credits. A hackathon offers $150.
- **Canada.** Meta's Connect recap says the API is "generally available globally". Earlier coverage said US-only preview. Meta's geographic policy
  does not list Canada as restricted. Only signing up will settle it.
- **Fidelity.** Meta's docs warn that on multi-image edits the model "can rearrange the layout and redraw contents rather than reproduce your
  inputs exactly", and every call is non-deterministic. It needs the same match check as Gemini. Editing works with `/v1/images/edits`.
- **SAM licence** (read in full): commercial use is not excluded. It bans military, weapons, espionage and nuclear uses, requires you to
  indemnify Meta, and Meta may change the terms.
- Meta's prices and models change quickly. Recheck before building on them.

### Tested through OpenRouter (25 Oct 2026, one test photo of a gold ring with a stone and a chain)
OpenRouter carries Meta's models behind one OpenAI-style address. No Meta model there is free: none has a `:free` version.
Reading the photo (cost for that one call):
- `meta/muse-spark-1.3`: correct ("thick gold ring, round light-blue stone, small dashed gold chain"). About $0.004, because it
  spends hundreds of hidden "thinking" tokens first. With a small `max_tokens` it returns nothing at all, so allow about 900.
- `meta/muse-glimmer-30b` ($0.30 / $1.20 per 1M tokens): also correct, about $0.0005. The best value of the Meta models.
- `meta-llama/llama-4-scout` ($0.10 / $0.30): fast and cheapest, but less accurate (called the stone white and the chain broken).
- Free, not Meta: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` read the photo correctly but took 29 seconds.
  `google/gemma-4-31b-it:free` was rate limited. Another free model only runs inside coding tools.
- `meta/muse-image` uses `/api/v1/images`, not chat. It needs purchased credits, so the image test was refused.
- Only the text and photo calls were allowed on the tested account, which has bought no credits. Do not rely on that continuing.

### Benchmark on the Studio's own jobs (`scripts/bench-models.mts`, drawn test pictures, 25 Oct 2026)
Job 1 writes product details from a photo using the real prompt and brand rules, graded on 15 checks. Job 2 is the real match-check prompt: score a
faithful redraw (should be high) and two altered pieces (should be low).

| Model | Cost | Details (of 15) | Read time | Faithful | Thinner band | Silver, 2 stones |
|---|---|---|---|---|---|---|
| `dots-studio/dots-3-note-preview:free` | free | 15 | 58 s | 100 | 20 | 40 |
| `nvidia/nemotron-3.5-super-vl:free` | free | 15 | 137 s | 100 | 35 | 30 |
| `meta/muse-glimmer-30b` | about 0.2 cents a call | 15 | 57 s | 100 | 15 | 15 |
| `meta-llama/llama-4-scout` | about 0.05 cents a call | 13 (missed the stone, hashtag count) | 25 s | 100 | 0 | 0 |
| `google/gemma-4-31b-it:free`, `gemma-4-26b-a4b-it:free` | free | 0 | n/a | n/a | n/a | n/a |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | free | 0 | n/a | n/a | n/a | n/a |

- The Gemma models returned "Provider returned error" on every call, so they were not judged on quality. The Nvidia nano model spent its whole
  6,000 token budget thinking and returned nothing. Free models can also vanish, so the provider drops any model OpenRouter calls invalid.
- **Chosen defaults:** the first two, both free. They separate the pictures clearly enough to use as a first check, but not as sharply as Llama 4 Scout,
  which is the best fault finder here at a twentieth of a cent a call. It is a good paid second opinion for the match check, though weaker at writing the details.
- **If you want paid but cheap:** `OPENROUTER_MODELS=meta/muse-glimmer-30b` reads the photo correctly and writes the details well.
- The test pictures are drawn shapes. Run the script on a short list with your own photos before trusting a score.
- **Image embeddings** (`nvidia/llama-nemotron-embed-vl-1b-v2:free`) scored the faithful redraw 0.96 and the altered ones 0.80 to 0.84. Not wired in:
  a real scene changes the background and layout, which lowers the similarity of a legitimate picture, so a fixed cut-off would raise false alarms.

## Suggested next steps
1. Phase 3: port the signature check and Graph wrapper from insta-p8 into `src/lib/providers/instagram.ts`, keeping our own claims gate.
2. Add an idempotency table for webhook events before any bot goes live.
3. Trial BiRefNet HR or matting on one chain and one ring, then score with `/check-images`.
4. Ask `provider-scout` to compare IC-Light against the current Gemini and fal scene modes on three pieces.
