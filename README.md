# EFJ Studio: Elegant Fashion Jewellery

Owner's private studio: catalog (Phase 1) and Visual Studio (Phase 2). See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Run

```
cd C:\dev\Fashion-jewellery
npm install
copy .env.example .env.local     # add keys if you have them (all optional; demo mode works without them)
npm run dev
```

Open http://localhost:3000

**Keep this project out of OneDrive / Dropbox.** Sync tools lock files in the `.next` build folder and cause random
errors. The project lives in `C:\dev\Fashion-jewellery`. Back up the `data` folder (your catalog and photos) yourself,
for example by copying it into OneDrive now and then.

## Workflow

1. **Upload** photos of one piece → the AI fills in the details, captions and hashtags.
2. **Edit** the product page: price, cost, stock, and the facts the AI can't see (base metal, sizes, nickel-free).
   The *Ready to post?* panel lists what is still missing. A product cannot be set to Ready / Scheduled / Posted
   while a required check fails (see below).
3. **Visual Studio** (button on the product page): **remove the background**, make **posters**, touch up photos,
   optionally create AI scenes and on-model shots, approve what you like, build the carousel.
4. **Download ZIP**: numbered 1080×1350 slides + `caption.txt`, ready to post from your phone.

## Pictures without generated pixels: background removal, studio shots and posters

All three start from your own photo. Nothing is generated: the code only cuts the background away and adjusts
colour, contrast and sharpness. Shape and details stay as photographed, but colour and shine are enhanced, so check each
picture against the piece in daylight before approving it.

**Remove background** (`src/lib/cutout.ts`) makes a clean-cream version and a **transparent cut-out** (PNG) of each
photo. It tries two methods, both free and local:

| Method | Works for | Needs |
|---|---|---|
| Gold colour | gold pieces, even in a busy room or on a display bust | nothing |
| Plain backdrop | silver, rose gold, stones | a plain backdrop that fills the frame; for silver use grey or black (light silver on a white card can lose its brightest parts) |

When fal.ai is the image provider, its BiRefNet cutout is used first; otherwise it is the fallback when neither local method works and a fal.ai key is set. That one is found by an AI model, so it
starts unapproved: check the edges, then press **Check & approve** in the Studio.

**Studio shots** (`src/lib/look.ts`) retouch the cut-out (white balance, levels, clarity, gold vibrance, sharpening, a
soft highlight glow) and place it on a backdrop drawn by code (Cream studio, Glossy reflection, Dark spotlight, Woven
linen), with your logo from Settings.

**Posters** (`src/lib/posters.ts`, in the Studio) put the cut-out on 6 templates (Info card, Arch, New in, Gift, Special
price, Minimal) × 6 colour themes (Cream, Blush, Sage, Midnight, Festive red, Marigold) × 3 sizes (post 4:5, square, story
9:16). Text is typeset by code in Cormorant Garamond and Montserrat. The banned-claims check runs in the browser and again on
the server. "Special price" uses the compare-at price from the product page and only checks that it is higher, so only
enter a price you really charged for a substantial period recently. Save posters to the library (they can be
carousel slides) or download a PNG. Link to a preset with `?template=arch&theme=midnight&format=story`.

## Using your Claude subscription (no API key)

A Claude Pro/Max subscription covers **Claude Code that you run yourself**. It does not include an API key, and
Anthropic's terms ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)) do not allow an
app or bot to route requests through subscription credentials. So the subscription does the thinking while *you*
drive it from Claude Code, and the app only stores the results. Nothing is sent to Claude automatically.

| Command (type it in Claude Code) | What it does |
|---|---|
| `/catalog-photos` | Reads the new photos in `inbox/`, groups them into products, writes details, captions, hashtags and questions for you, and saves them in the app as drafts. Stops and asks if a piece shows a designer logo. |
| `/check-images 3` | Compares every AI-generated picture of product 3 with your real photos, writes a match score and notes into the Studio. |

Both use `scripts/efj.mjs`, a small helper that only talks to this app (`node scripts/efj.mjs list`, `show`, `create`,
`update`, `images`, `score`). It holds no keys. The server-side checks still apply: banned claims block Ready.

| Job | Best fit | Needs |
|---|---|---|
| Catalog copy, picture checks, batches | Claude Code with your subscription (above) | nothing new |
| Pictures (scenes, on-model) | Gemini | existing key |
| Always-on Instagram DM bot (later) | Claude API, `claude-haiku-5-5` ($0.10 in / $0.50 out per 1M tokens, roughly a tenth of a cent per chat) | an API key plus about $5 credit |
| Bot without any API key | Gemini, or reply drafts you approve | existing Gemini key |

## Safety checks (src/lib/claims.ts)

Blocked in any text of a Ready product: "solid gold", "real/genuine/pure gold", "10K gold" without "plated",
"waterproof", tarnish-free / fade-proof / lasts-forever claims, "hypoallergenic", and any karat other than 10K.
Also required: name, a price, at least one photo and "10K gold-plated" in the plating field.

## AI providers (all hosted, nothing runs on your PC)

Two jobs, chosen separately in `.env.local` (see `.env.example`):

| Job | `VISION_PROVIDER` reads photos and decides | `IMAGE_PROVIDER` makes pictures |
|---|---|---|
| Does | Product details, captions, match scores (and later the Instagram DM bot) | Scenes, on-model, scale shots |
| Options | `claude`, `gemini`, `deepinfra`, `demo` | `gemini`, `fal`, `demo` |

| Key | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (default `claude-opus-5-5`). Needs an API key from console.anthropic.com, billed per use. A claude.ai subscription does **not** include one. Claude cannot make pictures. |
| `GEMINI_API_KEY` | Gemini: reads photos (`gemini-3.1-flash-lite`) and makes pictures (`gemini-3.1-flash-image`) |
| `FAL_KEY` | fal.ai: open-weight pictures (Qwen-Image-Edit-Plus) and the safe-mode cutout (BiRefNet) + backdrop (FLUX schnell) |
| `DEEPINFRA_API_KEY` | DeepInfra: open-weight photo reading (Qwen3-VL) |

Recommended setup: `VISION_PROVIDER=claude` (best judgement and writing) + `IMAGE_PROVIDER=gemini` (pictures).

Scenes have two modes. **Natural** re-draws the scene, so light looks real but small details on the piece can drift
(Gemini turned a thin-band ring into a chunky solitaire in testing, which is why the match score matters).
**Safe mode** keeps your real product pixels and only generates the background; it needs `FAL_KEY`.

Generated images always start unapproved. When a vision provider is active, each natural-mode image is compared with your
real photos and gets a match score (red under `FIDELITY_MIN`, default 75). Only approved images can go into a carousel.

## Where things live

| Path | What |
|---|---|
| `data/efj.db` | SQLite database (created on first run) |
| `data/uploads/` | Photos: originals, generated images, cards (full size + thumbnails) |
| `docs/BRAND.md` | Brand voice; loaded into every AI prompt |
| `src/lib/ai.ts` | Product analysis (photo → category, copy, captions, owner questions) |
| `src/lib/visuals.ts` | Touch-up, natural and safe-mode scenes, match check |
| `src/lib/providers/` | fal.ai and DeepInfra clients (the only code that talks to them) |
| `src/lib/config.ts` | Model IDs and key checks |
| `src/lib/presets.ts` | Scene and pose presets (edit these to change the looks) |
| `src/lib/claims.ts` | Banned-phrase scanner and readiness checks |
| `src/lib/db.ts` | Database schema and queries |

`data/` and `.env.local` are git-ignored. Back up `data/` regularly: it is your catalog.

## Workflow (upload, render, optional AI, Gemini prompt)

1. **Upload** photos. No AI runs. Duplicate photos are caught and you choose to skip or upload anyway.
2. **Rendered images**: four studio looks per photo, made from your real photo (BiRefNet or gold-colour cutout, picked per photo). Download one by one or as a ZIP.
3. **Write description with AI** (button on the product): fills description, tags and the brand marks seen on the piece.
4. **Gemini prompt**: pick a style, copy the prompt, download your photos, paste both into Gemini.
5. **Brand marks gate**: if a piece shows another brand's name or logo, say whether it is genuine before it can be marked Ready or posted. Marks are never removed from photos or text.

Run with `npm run dev` (binds 127.0.0.1 only). Tests: `npm test`.
