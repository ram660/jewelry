# Music for Reels

Put the music tracks for Instagram Reels here (MP3, M4A, AAC or WAV). The Instagram page in the Studio uses them for
"Create Reel" (a different track each time when there is more than one) and lists them under "Reel with music".

## The shop's own music beds

`Soft glow`, `Sparkle`, `Sunday morning` and `Evening shimmer` were made for the shop by `node scripts/make-music-beds.mjs`
from plain synthesised tones (no samples or anyone else's music). They are free to use in any post. See
`EFJ music beds - licence.txt`.

## Adding other music

- Instagram's own music library (including the Meta Sound Collection) can't be added to posts made through its API: it only
  works inside the Instagram app. A Reel made here only has sound if the video already contains it.
- Don't use popular commercial songs. A business account isn't licensed for them, and the Reel is likely to be muted or taken down.
- Use royalty-free music whose licence allows commercial use on social media, for example: YouTube Audio Library,
  Pixabay Music, Mixkit, Uppbeat (free tier, with its credit line) or Free Music Archive (only tracks marked for commercial use).
- **Keep a licence note for every track you add**: a text file next to it with the same name (for example
  `Golden hour.mp3` and `Golden hour - licence.txt`) saying where it came from, the licence, and any credit line it needs.

The music files are not committed to git (see .gitignore).
