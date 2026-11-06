---
name: stock-images
description: Collect free stock photos and short videos (Pexels, Pixabay, Unsplash official APIs) into theme folders for education and mood posts, carousels and Reels B-roll. Use when the owner wants background, styling-idea or teaching pictures that are not their own products, or sends Pexels/Pixabay/Unsplash links.
argument-hint: "<themes file | link> [--theme name] [--max n]"
---

You are collecting stock pictures for **Elegant Fashion Jewellery** content: layering guides, ear and ring stacks,
occasion boards, care tips and Reels B-roll. They support the teaching; the shop's own pieces always come from the
owner's photos (`/instagram-kit`).

## Rules that never bend
- **A stock picture is never a product.** Never put one in a product record, a kit, a price post or anything that
  suggests the shop sells that piece. Never caption a stock piece as "10K gold-plated" (we don't know what it is) or with
  any word that `src/lib/claims.ts` bans (real/solid gold, other karats, sterling, diamond, waterproof, hypoallergenic...).
- Only Pexels, Pixabay and Unsplash through their APIs. No Google Images, Pinterest, Instagram or brand sites: those
  pictures belong to someone else.
- No brand names: skip any result with a visible logo, brand or designer name, on the jewellery or in the background.
- Keys live in `.env.local` (`PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`). Never read or print that file;
  the script loads it. If a key is missing, tell the owner which one and that it is free (`.env.example` has the links).
- Keep `stock/credits.csv`. It records author, page and licence for every file. Pexels and Unsplash ask for a credit
  when it is practical (alt text or caption "Photo: <author> / Unsplash"); Pixabay doesn't require it but it is kind.
- Canadian spelling in folder names and any text you write (jewellery, colour).

## Steps
1. Add or adjust lines in `scripts/stock-themes.txt` (or pass a link with `--theme`). Lines look like
   `03_ear_stacks | unsplash: ear stack`, `20_reels_broll | pexels videos: putting on necklace`, or a full link.
   Specific words work better than broad ones: "pearl earrings" beats "fashion jewellery".
2. Run, with the off-topic filter:
   `npm run stock -- scripts/stock-themes.txt --must "jewel,necklace,earring,ring,bracelet,bangle,pearl,pendant,chain,anklet,gem"`
   (for videos use `--must "jewel,necklace,earring,ring,bracelet,bangle,pearl"` too; Pixabay video results drift off-topic).
   Results tagged AI-generated are skipped by default (`--allow-ai` keeps them); our rule is that pictures show real jewellery.
   If a search finds 0, shorten it: Unsplash has nothing for "ear stack earrings" but 2,000+ for "ear stack".
3. If a site throttles (Unsplash demo keys allow 50 requests an hour, about 45 photos), simply run it again later:
   files already downloaded are skipped.
4. Look at the results (make a contact sheet with `sharp` if there are many) and move off-topic files to
   `stock/_rejected/`. Report the count per theme and which themes are thin.
