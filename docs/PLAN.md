# Elegant Fashion Jewellery — Build Plan

**Goal:** photos in → catalog, visuals and captions → Instagram posts → bot answers
questions and takes orders → owner steps in only when needed.
**Market:** Vancouver / Metro Vancouver first, then the rest of Canada. English. Prices in CAD.
**Product:** 10K gold-plated rings, bracelets, chains, necklaces, earrings (mostly women's).

Related docs: [BRAND.md](BRAND.md) (voice & persona), [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) (bot answers).

---

## 0. Guiding principles

1. **The product must stay real.** AI may change the background, light and setting,
   never the jewellery itself. Every generated image is checked against the original
   and approved by the owner before it can be posted.
2. **Structured data first.** Every product is a structured record. Captions, posts
   and bot answers are all generated from it, so they never contradict each other.
3. **Human approval at every stage at first.** Remove approval steps one by one
   as trust in the system grows.
4. **Hosted models by default, one small local model by choice, and the "brain" and the "hands" are separate.**
   The one exception is the BiRefNet cutout (MIT, 109 to 467 MB), which can run on the owner's computer for free
   and in private. It is chosen with `CUTOUT_MODE` and installed with `node scripts/get-birefnet.mjs`. Nothing else runs locally.
   *Reading photos and deciding* (details, captions, match scores, later the DM bot) runs on
   Claude, Gemini or DeepInfra (Qwen3-VL). *Making pictures* runs on Gemini or fal.ai
   (Qwen-Image-Edit, BiRefNet, FLUX). Claude cannot make pictures. Provider code is isolated in
   `src/lib/providers/` and every model ID is a setting, so any piece can be swapped.

---

## 1. Architecture

```
 ┌──────────── Owner UI (Next.js, runs on laptop → later Vercel) ────────────┐
 │ Upload │ Catalog │ Product editor │ Visual studio │ Calendar │ Inbox │ Orders │
 └───────────────┬───────────────────────────────────────────────────────────┘
                 │
     ┌───────────┴───────────┐        ┌───────────────────────────┐
     │ Supabase (Phase 3+)   │        │ DeepInfra: Qwen3-VL       │
     │  • Postgres (catalog, │◄──────►│  • analyse photos, write  │
     │    posts, chats,      │        │    copy, match score      │
     │    orders)            │        │ fal.ai                    │
     │  • Storage (public    │        │  • Qwen-Image-Edit-Plus:  │
     │    image URLs for IG) │        │    scenes, on-model       │
     │  Today: SQLite + disk │        │  • BiRefNet + FLUX schnell│
     └───────────┬───────────┘        │    safe-mode scenes       │
                 │                    └───────────────────────────┘
                 │  (Phase 3+)
     ┌───────────┴──────────────┬──────────────────┬───────────────┐
     │ Instagram Graph API      │ Stripe           │ Chit Chats /  │
     │  publish, comments, DMs  │ payment links,   │ Canada Post   │
     │  (webhooks)              │ webhooks         │ labels        │
     └──────────────────────────┴──────────────────┴───────────────┘
```

**Stack:** Next.js (App Router, TypeScript) · Tailwind + shadcn/ui · Supabase
(Postgres, Storage, Auth for the owner only; added in Phase 3) · plain `fetch` to
fal.ai's queue API and DeepInfra's OpenAI-style API · `sharp` for resizing, cutout
compositing and the carousel export.

**Model IDs live in `.env.local`, not in code**, because hosts rename and retire models.
Defaults: `fal-ai/qwen-image-edit-plus`, `fal-ai/birefnet/v2`, `fal-ai/flux/schnell`,
`Qwen/Qwen3-VL-30B-A3B-Instruct`.

**Licences to re-check before launch** (these models are open-weight, but terms differ):
Qwen-Image-Edit (Apache 2.0, confirm on its Hugging Face card), BiRefNet (MIT, confirm),
FLUX schnell (fal tags it for commercial use). Avoid FLUX.1 Kontext [dev] and RMBG-2.0: both
are non-commercial unless you buy a licence.

---

## 2. Data model (Phase 1 tables marked ★)

| Table | Key fields |
|---|---|
| ★ `products` | id, sku (e.g. `EFJ-RG-0012`), name, category (ring/bracelet/chain/necklace/earring/anklet/set), subcategory (stackable, statement, tennis, cuban, paperclip, hoop…), gender (women/men/unisex), plating (`10K gold-plated`), base_metal, plating_microns, nickel_free, hypoallergenic, anti_tarnish, stones (type, colour, approx count), colour_finish (yellow/rose/white, polished/matte/hammered), sizes / length / adjustable, weight_g, price_cad, cost_cad, compare_at_cad, stock_qty, low_stock_at, status (draft → ready → scheduled → posted → sold_out / archived), style_tags[], occasion_tags[], short_desc, long_desc, care_notes, created_at |
| ★ `product_images` | id, product_id, kind (original / enhanced / cutout / scene / on_model / scale / price_card / reel_frame), storage_path, public_url, prompt_used, model_used, fidelity_score, fidelity_notes, approved, sort_order |
| ★ `product_copy` | product_id, caption_variants[3], hashtags[], alt_text, faq (product-specific Q&A), ai_questions_for_owner[] |
| ★ `inventory_movements` | product_id, delta, reason (restock / sale / damaged / adjust), ref, at |
| `posts` | id, type (carousel/single/reel/story), product_ids[], media_ids[], caption, scheduled_at, ig_media_id, status, metrics (likes, saves, reach, DMs) |
| `customers` | ig_user_id, ig_handle, name, email, phone, address, marketing_consent (CASL) |
| `conversations` / `messages` | ig_thread_id, customer_id, product_context, state, needs_human, assigned_to; message role/text/at |
| `orders` | id, customer_id, items[], subtotal, shipping, tax (GST/PST), total, stripe_link, paid_at, status, tracking_no |

---

## 3. Phases

### Phase 1: Catalog Studio (build first, ~1–2 weeks)

**Screens**
1. **Upload.** Drag in many photos at once. Group them into products automatically
   (AI decides which photos show the same piece) and adjust the groups by hand.
   Shows the shot checklist (below).
2. **AI analysis (automatic after upload).** Qwen3-VL looks at the photos plus the
   product name you typed and returns JSON:
   category, subcategory, gender, colour/finish, stones, style and occasion tags,
   3 name suggestions, short and long description, 3 caption variants in Ella's voice,
   hashtags, alt text, care notes, and a list of **questions for the owner** about
   things a photo can't show (base metal, size, weight, nickel-free).
3. **Product editor.** Every AI field is editable, with ✓ accept / ↻ regenerate per
   field. Price, cost, stock and SKU are entered here. Margin is shown live.
4. **Catalog grid.** Filter by category and status. Search. Low-stock badges. Bulk
   actions (mark ready, archive).
5. **Inventory.** Stock list, movement history, CSV export.
6. **Settings.** Brand voice (loads BRAND.md), knowledge base facts
   (KNOWLEDGE_BASE.md §1), model IDs, API key status.

**Done when:** you can upload 20 products, get usable descriptions with less than
2 minutes of editing each, and export the catalog.

### Phase 2: Visual Studio (~2 weeks)

Pipeline per product. Each step produces images you can approve or reject:

| Step | Output | How |
|---|---|---|
| Enhance | colour-corrected, white-balanced original | `sharp` (local, free) |
| Cutout | product on transparent background | background removal |
| Scenes | 3–6 styled backgrounds | *Natural:* Qwen-Image-Edit-Plus with up to 3 of your photos as reference. *Safe mode:* BiRefNet cuts out your real product, FLUX schnell makes only the backdrop, `sharp` composites them with a contact shadow. Scene presets below |
| On-model | hand / wrist / neck / ear shots, varied skin tones | Qwen-Image-Edit-Plus using your originals as reference |
| Scale shot | piece on a hand or next to a coin | Qwen-Image-Edit-Plus; a real photo with a coin is more honest |
| Price / info card | name, "10K gold-plated", price, sizes | **rendered by code** (HTML → image), not AI, so the text is always correct |
| Carousel | 1080×1350 (4:5), 4–7 slides | assembled automatically, reorder by drag |
| Reel (later) | 6–10 s vertical clip, 1080×1920 | image-to-video model + music added in the IG app |

**Scene presets (Vancouver flavour):** white marble · warm linen · cedar wood
grain · rainy-window bokeh · sea-glass & pebbles (English Bay) · golden-hour
sunlight · dark velvet gift box · festive (Diwali diyas / Lunar New Year red / Christmas).

**Fidelity check:** after each generation, Qwen3-VL compares the original and the
generated image ("same number of stones? same shape, chain links, clasp, colour?")
and returns a score with notes. Anything below the threshold is auto-rejected.
You still approve the final set.

**Recommended carousel order:** ① best scene → ② on-model → ③ real photo
(lightly enhanced) → ④ close-up → ⑤ scale shot → ⑥ price/info card.

### Phase 3: Instagram Publishing (~1 week of build + Meta approval time)

**Start the setup now. Meta review takes weeks:**
- [ ] Switch @account to a **Business** (or Creator) account
- [ ] Create a Meta developer app, use "Instagram API with Instagram Login"
      (no Facebook Page needed)
- [ ] Business verification (business name and documents)
- [ ] App Review for `instagram_business_content_publish`,
      `instagram_business_manage_comments`, `instagram_business_manage_messages`
- [ ] Privacy policy and terms page (a simple public page from our app)

**Build:** content calendar (drag products onto days), auto-publish at the scheduled
time (API limit is 100 posts a day, plenty), carousel up to 10 items via API,
pull metrics back into `posts`.

**Posting rhythm to start:** 4 feed posts + 3 Reels + daily Stories a week.
Post 11:00–13:00 or 19:00–21:00 Pacific time. Adjust from the metrics after 4 weeks.

### Phase 4: Ella, the DM & comment bot (~2 weeks)

**Flow**
```
IG webhook (DM / comment / story reply)
  → identify customer + which product (from the post they came from, or by matching a photo or name)
  → classify intent: price · size · material/plating · care · shipping · order · complaint · other
  → build answer from: product record + KNOWLEDGE_BASE.md + BRAND.md (no free invention)
  → guardrail check (banned claims, unknown facts, sentiment)
  → send   OR   flag "needs human" → owner Inbox + phone notification
```
- **Comment → DM:** "Comment ✨ for price". The bot replies publicly ("Sent you a DM 💛")
  and sends one private reply with the details. Meta allows one private reply per
  comment, within 7 days.
- **Messaging window:** 24 h after the customer's last message (7 days for chats
  started from ads). The bot must answer fast. Human follow-ups after 24 h need the
  `HUMAN_AGENT` tag, which needs its own approval.
- **Owner Inbox screen:** every conversation, the bot's draft replies, one-click
  take-over, and the bot pauses on that thread while you're replying.
- **Before go-live:** test against 100+ realistic questions (we'll write the test set),
  and run in "draft only" mode for a week, where the bot suggests and you send.
- **Stopgap until then:** ManyChat (no-code) can handle comment-to-DM keyword replies.
- **Hosting decision needed first:** the Studio has no login and must stay off the public internet. The webhook needs a public address, so
  build it as a separate small service (verify Meta's signature, de-duplicate events, store drafts) or add a login to the Studio before
  exposing anything. Patterns to borrow are in [REFERENCES.md](REFERENCES.md).

### Phase 5: Orders & Fulfilment (~1–2 weeks)

1. Customer says "I'll take it" → the bot confirms item, size and quantity → **holds stock for 30 min**.
2. Collects name, email, shipping address (or the local pickup option).
3. Sends a **Stripe Payment Link** in CAD (card, Apple Pay, Google Pay). Interac
   e-Transfer is a manual option you confirm yourself.
4. Stripe webhook "paid" → order confirmed DM → stock decremented → appears in Orders.
5. Create the shipping label (Chit Chats, which is Vancouver-based and cheap for small
   parcels, or Canada Post) → tracking number sent by DM automatically.
6. 7 days after delivery: review and photo request, re-order or styling tip.

**Taxes:** GST 5% + BC PST 7%. Under $30k/yr revenue you may qualify as a small
supplier (GST) and small seller (PST). Confirm with an accountant before launch,
and the order system will support both modes.

---

## 4. Business setup checklist (in parallel, Canada / BC)

- [ ] Register the business name (BC Registries) and get a business bank account
- [ ] Check that `@elegantfashionjewellery` (or similar) and the domain are available
- [ ] Get plating specs from your supplier in writing: base metal, microns, nickel/lead-free
- [ ] Decide policies: returns, exchanges, earrings final sale, plating warranty
- [ ] Packaging: branded gift box + care card (the care tips from the KB)
- [ ] Stripe account (Canada)
- [ ] Shipping: Chit Chats account, padded mailers, scale
- [ ] Photo kit: lightbox, white and grey backdrop, phone tripod

### Photo shot list (shown in the Upload screen)
For every piece: **front · side/profile · close-up of details/stones · clasp or back ·
scale (on hand or next to a coin)**. Natural or daylight-balanced light, no flash,
plain background, fill the frame, and the same setup every time.

---

## 5. Timeline (indicative)

| Week | Build | In parallel (you) |
|---|---|---|
| 1–2 | Phase 1 Catalog Studio | Meta Business + developer app, supplier specs, policies |
| 3–4 | Phase 2 Visual Studio | Photograph the full inventory, fill in KB §1 |
| 5 | Phase 3 Publishing | Post manually from the generated content to start growing |
| 6–7 | Phase 4 Ella bot (draft mode) | Answer DMs with the bot's drafts |
| 8–9 | Phase 5 Orders | Stripe + Chit Chats accounts |
| 10 | Bot goes autonomous for safe intents | Review weekly |

You can start posting manually in week 3. Automation makes it easier, but you
don't need to wait for it.

---

## 5b. Using a Claude subscription (no API key)

Anthropic does not allow an app or a bot to run on Pro/Max subscription credentials; developers building products must
use an API key (https://code.claude.com/docs/en/legal-and-compliance). So until an API key exists:

- **Owner-driven work uses Claude Code** (covered by the subscription): `/catalog-photos` writes catalog entries from
  photos in `inbox/`; `/check-images <id>` scores generated pictures against the real photos. The app stays passive and
  stores the results through its REST API (`scripts/efj.mjs`). Nothing is sent to Claude automatically.
- **Pictures** keep coming from Gemini inside the app.
- **Phase 4 (DM bot) is the one piece that needs a decision:** a Claude API key with `claude-haiku-5-5`
  (about $5 of credit goes a long way), or Gemini as the bot's brain, or reply drafts the owner approves from Claude Code.

## 6. Open items from owner

- [ ] fal.ai API key and DeepInfra API key (store in `.env.local`, never commit)
- [ ] First batch of photos + product names → `samples/`
- [ ] Fill in **[CONFIRM]** items in KNOWLEDGE_BASE.md
- [ ] Price list (or let the app suggest price tiers from cost)
- [ ] Instagram handle
