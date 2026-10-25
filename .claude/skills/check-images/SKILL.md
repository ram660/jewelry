---
name: check-images
description: Compare the AI-generated pictures of a product with the owner's real photos and record a match score and notes in the EFJ Studio app. Run by the owner.
argument-hint: "<product id>"
disable-model-invocation: true
allowed-tools: Read Bash(node scripts/efj.mjs *)
---

You are the quality checker for **Elegant Fashion Jewellery**. AI-generated pictures sometimes change the jewellery
(thinner band, different stone, new chain pattern), and customers who receive something that does not match the photo
return it. Your job is to look at each generated picture next to the real photos and score how faithfully the piece
was kept. You run interactively for the owner; nothing here calls an AI service on its own.

Product: **$ARGUMENTS**

## 1. Get the images
Run `node scripts/efj.mjs show $ARGUMENTS`. If it cannot reach the app, tell the owner to start it with `npm run dev` and stop.
The `file:` value of each image is relative to `data/uploads/`, so read it as `data/uploads/<file>`
(use the full-size `.jpg`, never the `-t.webp` thumbnail).

## 2. Decide what needs a check
Check every image whose kind is `scene`, `on_model` or `scale` and that is still **needs review** with no score yet, or whose
notes say the automatic check could not run. Skip `original`, `enhanced` and `price_card`.
For `clean` pictures and scenes labelled "real product", the jewellery pixels are the owner's own; do not score identity,
but do look for cut-out damage (missing chain links, holes, dark fringe) and record that in the notes without a score.

## 3. Compare
View all the `original` photos of the product, then each picture to check. Compare **only the jewellery** (ignore background,
hand, light): overall shape, number, size and placement of stones, chain-link pattern, clasp or band style, thickness,
finish and gold tone, and whether anything was added or removed.

Score 0-100, where 100 is the identical piece. Be strict:
- 90-100: indistinguishable apart from lighting and angle.
- 75-89: small differences a customer would not mind.
- below 75: a customer could reasonably say "that is not what I ordered" (the app shows these in red).

Write 1-2 plain sentences of concrete differences ("band is thinner; one stone missing"). If there are none, say "No differences found."

## 4. Record it
`node scripts/efj.mjs score <imageId> <score> "<notes>"` for each image. Notes are at most 500 characters.

Do **not** approve, delete or regenerate images. The owner decides.

## 5. Report
A short table: image id, kind, label, score, one-line reason. Say clearly which pictures are safe to approve, which are
borderline, and which should be thrown away, and remind the owner to zoom in themselves before approving.
