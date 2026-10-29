---
name: instagram-kit
description: Make the standard Instagram kit for a product from the owner's photos - BiRefNet cutout, a rotating studio template with the shop logo, 4:5, square, Story and close-up images, plus post notes with product info, captions, hashtags and alt text. Use whenever the owner sends new product photos to post.
argument-hint: "<photo folder> <product name>"
---

You are making Instagram images and post notes for **Elegant Fashion Jewellery** (Vancouver). The owner wants this to be
the standard for every new batch of photos, so do the whole thing without stopping to ask. Fill gaps with clear
[BRACKETS] instead of questions, and list them once at the end.

## 0. Rules that never bend
- Read `docs/BRAND.md` and `docs/KNOWLEDGE_BASE.md` before writing copy. `src/lib/claims.ts` is the list of banned wording.
- **Never write any brand, designer, maker or collection name** anywhere: captions, hashtags, alt text, file names,
  notes, or your messages. Not even to explain why something was left out.
- **A logo or brand mark stamped on the jewellery itself:** leave that piece out completely. Don't cut it out, don't
  render it, don't describe it. In the output and in your reply, say only "skipped".
- **A brand name in the background** (pad, box, card, bag): keep the photo but cut that part away with `--crop` so it
  can't survive the cutout, and say nothing about it.
- Never invent price, material, size, plating or stock. Gold-tone pieces are "10K gold-plated" (unconfirmed until the
  owner says so); silver-tone pieces never get "10K gold-plated", their material is [CONFIRM].
- Never: dupe, inspired, replica, lookalike, "look for less", designer, luxury, real/solid gold, sterling, diamond,
  white gold, waterproof, tarnish-free, hypoallergenic. Canadian spelling, CAD prices.
- The jewellery's pixels are never changed. The script only replaces the background.

## 1. Collect the photos
Put the product's photos in their own folder (the photos the owner sent, or a folder they name; never `inbox/`,
`samples/` or `data/`). One product per run: a matching set is one product. HEIC can't be read; ask for JPG.

## 2. Look at every photo
View each with Read. Decide per photo:
- a mark stamped on the piece → `--skip <file>` (or leave the whole product out if every photo shows it)
- a brand name in the background → `--crop <file>=left,top,width,height` (fractions 0 to 1 of the photo) that keeps the
  piece and drops the name
- the piece sits on a black velvet bust or pad, and has no black stones or enamel → add `--drop-dark`

## 3. Run it
```
npm run insta -- <photo-folder> <product-name> [--drop-dark] [--skip <file>] [--crop <file>=l,t,w,h]
```
It needs the local model (`node scripts/get-birefnet.mjs lite` once) and takes about 40 seconds a photo. Output lands in
`instagram/<product-name>/`. The template rotates automatically (gold-tone and silver-tone pieces each have their own
list), so don't pass `--template` unless the owner asks for a particular look. Templates: ivory, gilded-frame,
blush-arch, noir, stone, horizon, sage-frame.

## 4. Check the images
View every 4:5 image and close-up. Look for velvet left behind, chain cut off, or a sliced piece floating mid-frame.
- Velvet left: run again with `--drop-dark` (cutouts are cached, so a re-run takes seconds).
- Close-up landed on plain chain: pass `--closeup <file>=l,t,w,h` (fractions of the cut-out piece), for example
  `0,0.58,1,0.42` for the charms along the bottom of a necklace.
- Cutout missed the piece entirely: say so and leave that photo out.

## 5. Fill in the post notes
Edit `instagram/<product-name>/<product-name>_post-notes.md`: describe the piece from the photos, finish (rule 0), two
or three captions in the brand voice, hashtags (always `#ElegantFashionJewellery #vancouverjewellery #shopsmallyvr
#yvrstyle` plus product tags), alt text per slide, and when to post. If an earlier kit exists for this product, reuse
its captions. Then run:
```
npm run insta -- --check instagram/<product-name>/<product-name>_post-notes.md
```
Fix anything it reports and run it again until it passes.

## 6. Hand over
Send the 4:5 images, the close-up and the notes to the owner, say where the folder is, list the [BRACKETS] still to
fill, and mention any photo or piece as "skipped" with no reason given.
