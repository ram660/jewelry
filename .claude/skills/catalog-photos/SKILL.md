---
name: catalog-photos
description: Turn new jewellery photos in the inbox folder into catalog entries in the EFJ Studio app (details, captions, hashtags, questions for the owner). Run by the owner.
argument-hint: "[subfolder of inbox]"
disable-model-invocation: true
allowed-tools: Read Glob Bash(node scripts/efj.mjs *) Edit(inbox/**)
---

You are cataloguing new product photos for **Elegant Fashion Jewellery** (Vancouver, 10K gold-plated fashion jewellery).
You work for the shop owner, who is running you interactively. The app only stores data; **you** look at the photos
and write the copy. Nothing here calls an AI service on its own.

Folder to import: `inbox/$ARGUMENTS` (the whole `inbox/` folder if no argument was given).

## 0. Read the rules first
Read `docs/BRAND.md` (voice, Ella, caption formula) and `docs/KNOWLEDGE_BASE.md` (what may be claimed) before writing anything.

## 1. Check the app is running
Run `node scripts/efj.mjs list`. If it says it could not reach the app, tell the owner to start it with `npm run dev` and stop.

## 2. Find the photos
Use Glob for `*.jpg`, `*.jpeg`, `*.png`, `*.webp` in the folder. Read `inbox/.imported.json` if it exists (a JSON list of
file names already imported) and skip those files. If nothing new is left, say so and stop.
HEIC photos cannot be imported: tell the owner to switch the phone camera to "Most Compatible" or export as JPG.

## 3. Look at every photo, then group them
View each photo with Read. Photos of the **same piece** from different angles belong to one product. Different pieces are
different products. A matching set (for example earrings plus a pendant) is one product with category `set`.
If you are not sure how to group, ask the owner before importing.

## 4. Stop on luxury-brand logos
If a piece carries a recognisable designer or luxury-brand logo or trademark, **do not write marketing copy for it**.
Create nothing for that product yet. Ask the owner whether it is an authentic piece they are reselling or a lookalike, and
explain that lookalikes with a brand's logo are counterfeits that cannot be sold or advertised. Continue with the others.

## 5. Write the entry for each product
Describe **only what is visible**. Produce these fields, using exactly these JSON keys:

| Key | Content |
|---|---|
| `category` | one of ring, bracelet, chain, necklace, earring, anklet, set, other |
| `subcategory` | for example stackable, statement, tennis, cuban, paperclip, hoop, signet |
| `gender` | women, men or unisex |
| `colour_finish` | for example "yellow gold, polished" |
| `stones` | what is visible, or an empty string |
| `name_suggestions` | 3 short, elegant names |
| `style_tags` / `occasion_tags` | 3-6 and 2-5 lowercase tags |
| `short_desc` | one sentence, at most 20 words |
| `long_desc` | 2-4 sentences for a product page, mentions "10K gold-plated" |
| `care_notes` | 2-3 short sentences |
| `captions` | 3 different Instagram captions following the caption formula in BRAND.md, **without** hashtags |
| `hashtags` | 10-14, each starting with `#`, including the local and brand pools |
| `alt_text` | one sentence describing the photo |
| `owner_questions` | short questions for the owner about anything a photo cannot show |

**Hard rules**
- The pieces are 10K gold-**plated**. Never write "10K gold" (without "plated"), "solid gold", "real gold", "pure gold",
  "waterproof", "tarnish-free", "fade-proof", "lasts forever", "hypoallergenic", or any other karat.
- Do not invent stones, sizes, weight, base metal, plating thickness or nickel-free status. Ask in `owner_questions` instead.
- **Never set** `price_cad`, `cost_cad`, `stock_qty`, `base_metal`, `sizes`, `plating_microns`, `nickel_free`,
  `hypoallergenic`, `anti_tarnish`, `weight_g`, `plating` or `status`. Those are the owner's facts.
- Canadian spelling. At most 2 emojis per caption, only from: ✨ 💛 🤍 🎁 📦 🌿. No price in captions.

## 6. Save it
1. `node scripts/efj.mjs create "<best name>" <photo paths> --category <category>` prints `{"id": N}`.
2. Write the fields to `inbox/.work/N.json` (an object that also contains `"mark_analysed": true`).
3. `node scripts/efj.mjs update N inbox/.work/N.json`.
4. Add the imported file names to `inbox/.imported.json` (a JSON list).

If `update` reports problems (for example a banned phrase), fix the text and run it again. **Never** set the status to
`ready`, delete anything, or start picture generation.

## 7. Report
Give the owner a short table: product id, name, category, link `http://localhost:3000/products/N`. Then list every open
owner question and anything you skipped or stopped on, with the reason. Remind them that price, stock, base metal and
sizes still need filling in, and that each product starts as a draft.
