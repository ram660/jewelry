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

## Cutouts on your own computer (optional, free, private)

"Remove background" normally uses the free gold-colour method, and fal.ai's BiRefNet when you have a fal key. You can also run
[BiRefNet](https://github.com/ZhengPeng7/BiRefNet) (MIT licence) on this computer. It works on any metal, needs no key and never uploads a photo.

```
node scripts/get-birefnet.mjs lite            # one-time download, 214 MB, checked against its published checksum
node scripts/cutout-local.mts photo.jpg out   # try it on one of your photos, writes out/photo-cutout.png and a preview
```

Set `CUTOUT_MODE=local` in `.env.local` to use it for every cutout. With the default `auto`, it is used when the gold-colour method
cannot find the piece (silver, rose gold) and there is no fal key.

Honest numbers from a laptop (Intel Core Ultra 5, 15 GB RAM, on battery): about 15 to 45 seconds per photo, so cutting out five photos
takes a few minutes. It is much faster plugged in. The graphics chip (Intel Arc) crashed the driver with this model, so it is CPU only.
The lite model is smaller than the one fal.ai runs, so fine chains can come out slightly ragged. Zoom in and check the edges before approving.
Models are stored in `~/.efj-studio/models` (outside the project, so OneDrive does not upload them).

## Instagram kit from a folder of photos (`npm run insta`)

The standard way to turn new product photos into Instagram images, all on this computer. In Claude Code, `/instagram-kit`
does every step for you, including checking the photos and writing the post notes.

```
npm run insta -- path/to/photos clover-set                 # one product per folder
npm run insta -- path/to/photos clover-set --drop-dark     # also remove a black velvet bust or pad
npm run insta -- --check instagram/clover-set/clover-set_post-notes.md   # banned-wording check before posting
```

For each photo you get a 4:5 feed image, a square, a Story and a 4:5 close-up in `instagram/<product>/`, plus a
`<product>_post-notes.md` to fill in. Only the background is replaced. Every image carries the shop logo (the one
uploaded in Settings, or the typeset placeholder). Each run picks the next of seven templates that suits the piece
(ivory, gilded-frame, blush-arch and noir for gold-tone; noir, stone, horizon and sage-frame for silver-tone; horizon for
both), so the grid keeps changing. `--template <name>` picks one. Other options: `--skip <file>` leaves a photo out,
`--crop <file>=l,t,w,h` keeps part of a photo before the cutout, `--closeup <file>=l,t,w,h` picks the close-up by hand.
Cutouts are cached in `instagram/<product>/.cutouts`, so a re-run with another template takes seconds.

## Stock photos and videos for teaching posts (`npm run stock`)

Free pictures and short clips for styling guides, care tips, occasion boards and Reels B-roll. They are **never
product photos**: don't put them in a product, a kit or a price post. They come only from the official Pexels, Pixabay
and Unsplash APIs, with the free keys in `.env.local` (see `.env.example`).

```
npm run stock -- scripts/stock-themes.txt --must "jewel,necklace,earring,ring,bracelet,bangle,pearl,pendant,chain,anklet,gem"
npm run stock -- "https://unsplash.com/s/photos/ear-stack" --theme 03_ear_stacks --max 30
```

Each line of `scripts/stock-themes.txt` is `theme_folder | site: words` (or a full link); `pexels videos:` and
`pixabay videos:` fetch clips. Files go to `stock/<theme>/` (not committed), with `stock/credits.csv` recording author,
page and licence. Results tagged AI-generated are skipped. Running it again skips files already downloaded, which helps
with Unsplash demo keys (50 requests an hour). In Claude Code, `/stock-images` does the same with the rules above.

## AI providers (hosted, except the optional cutout above)

Two jobs, chosen separately in `.env.local` (see `.env.example`):

| Job | `VISION_PROVIDER` reads photos and decides | `IMAGE_PROVIDER` makes pictures |
|---|---|---|
| Does | Product details, captions, match scores (and later the Instagram DM bot) | Scenes, on-model, scale shots |
| Options | `claude`, `gemini`, `deepinfra`, `openrouter`, `demo` | `gemini`, `fal`, `none` (no AI pictures) |

| Key | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (default `claude-opus-5-5`). Needs an API key from console.anthropic.com, billed per use. A claude.ai subscription does **not** include one. Claude cannot make pictures. |
| `GEMINI_API_KEY` | Gemini: reads photos (`gemini-3.1-flash-lite`) and makes pictures (`gemini-3.1-flash-image`) |
| `FAL_KEY` | fal.ai: open-weight pictures (Qwen-Image-Edit-Plus) and the safe-mode cutout (BiRefNet) + backdrop (FLUX schnell) |
| `DEEPINFRA_API_KEY` | DeepInfra: open-weight photo reading (Qwen3-VL) |
| `OPENROUTER_API_KEY` | OpenRouter: **free** photo-reading models behind one key (see below) |

### Free photo reading with OpenRouter

Set `OPENROUTER_API_KEY` and `VISION_PROVIDER=openrouter`. The Studio then reads photos, writes the details and checks pictures with free
models, tried in order, so a busy one hands over to the next. The defaults were measured on this app's own jobs: both scored 15 of 15 on
writing product details with the brand rules, and both told a faithful picture from an altered one.

- **Limits:** 20 requests a minute and 50 a day until you buy credits (about 1,000 a day after $10). One analysis or one match check is one request.
- **Privacy:** free hosts may keep prompts. Only your own product photos are sent. Customer messages never are, because the Instagram
  reply writer runs on rules, not an AI service. `OPENROUTER_PRIVACY=strict` limits routing to hosts that promise not to keep prompts, but few free models qualify.
- **Speed:** about 40 seconds for a full analysis, because these models think before answering.
- **Compare models yourself:** `OPENROUTER_API_KEY=... node scripts/bench-models.mts --free` tests every free vision model on both jobs.

Recommended setup: `VISION_PROVIDER=claude` (best judgement and writing) + `IMAGE_PROVIDER=gemini` (pictures).

**Current setup in use: real photos only.** Gemini reads photos and writes the text. **No AI makes any picture.** BiRefNet on this computer cuts
your jewellery out of your own photo, and the backdrop is drawn by code, so your real product pixels are never redrawn:

```
VISION_PROVIDER=gemini
IMAGE_PROVIDER=none
CUTOUT_MODE=local
```

What this means in the Studio:
- **Remove background, touch-ups, info cards and the carousel** work as before.
- **Styled scenes** always use your real cutout on a backdrop drawn by code (marble, linen, cedar, rainy window, sea glass, golden hour, velvet,
  Diwali, Lunar New Year). They are clean, stylised surfaces rather than photographs. They are unapproved until you approve them.
- **On-model and scale shots are off**, because only an AI can make them. Photograph the piece worn and upload it instead.
- A Gemini key alone never starts picture-making: `IMAGE_PROVIDER` left on `auto` only uses fal.ai, never Gemini. Choose Gemini pictures on purpose
  with `IMAGE_PROVIDER=gemini`. Preview the backdrops with `node scripts/backdrops-preview.mts`.

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
| `src/lib/localCutout.ts` | BiRefNet cutout that runs on this computer |
| `src/lib/patch.ts`, `src/lib/readiness.ts` | Validation of product edits, and the ready re-check after a photo changes |
| `relay/` | The small public Instagram webhook relay (see `docs/INSTAGRAM.md`). The Studio itself never goes online |
| `src/app/inbox/`, `src/lib/ella.ts`, `src/lib/inboxService.ts` | The Instagram inbox: customer messages, draft replies, approve and send |
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
