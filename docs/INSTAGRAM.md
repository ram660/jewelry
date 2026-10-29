# Instagram automation: our design

Inspired by [insta-p8](https://github.com/ayuuxh2/insta-p8), built differently because our situation is different. insta-p8 is one public
web app that does everything. EFJ Studio holds the whole catalog, has no login, and must never face the internet.

## The idea: a tiny public relay, a private Studio

```
 Instagram ──signed webhook──▶  RELAY (public, tiny)          STUDIO (private, your computer)
                                 • checks the signature   ◀──── pulls new events (outbound only)
                                 • drops duplicates              • writes DRAFT replies from the
                                 • queues for 7 days               product record + KNOWLEDGE_BASE.md
                                 holds NO access token,          • runs every draft through claims.ts
                                 NO catalog, NO AI key           • you approve in the Inbox
                                                                 • Studio sends via the Instagram API
                                                                   (the access token never leaves it)
```

Why this beats a single public app for us:
- **Nothing private is exposed.** If the relay is attacked, the attacker gets a queue of public comments. They cannot post, message or read
  the catalog, because those secrets live only on your computer.
- **Works from a laptop.** The Studio only makes outbound requests, so no tunnel, no open port, no static address.
- **Safer by default.** Draft-first with your approval, and every draft goes through the same banned-claims check as product copy.
  insta-p8 sends AI replies directly and tells the model to hide that it is an AI. Ours does neither.
- **No back door.** insta-p8 has an environment switch that turns signature checking off. The relay has none.
- **Cheap.** One small always-on process and one SQLite file. It runs on a free or $5 host, or on a Raspberry Pi.

## What is built (in `relay/`)

| File | Job |
|---|---|
| `relay.ts` | Signature check, Meta handshake, payload parsing, queue pull. Standard `Request`/`Response`, so it also runs on Vercel, Cloudflare or Deno. |
| `sqlite-store.ts` | Durable queue in one SQLite file, de-duplicated by Instagram's own message and comment ids. |
| `server.ts` | Plain Node wrapper: `node relay/server.ts`. Refuses to start without its three secrets. |
| `scripts/relay.test.mts` | Tests: bad signatures, duplicates, wrong tokens, junk payloads, fail-closed, restart, pruning. Run with `npm test`. |

Behaviour worth knowing:
- Unsigned or wrongly signed deliveries get 401 and store nothing. Missing configuration answers 503 to everything, never "open".
- Echoes of our own messages, read receipts, delivery receipts and reactions are dropped, so the bot cannot answer itself.
- A storage failure returns 500 so Meta retries, and the duplicate check absorbs the retry.
- The pull endpoint needs `Authorization: Bearer <RELAY_PULL_TOKEN>` and supports `after` (cursor) and `limit`.
- Events older than 7 days are deleted.

## What is built in the Studio (the Inbox page)

| Piece | Where | Job |
|---|---|---|
| Inbox page | `src/app/inbox/` | Customers on the left, their messages and draft replies on the right. Edit, approve, copy, dismiss. A badge in the menu counts open drafts. |
| Reply writer ("Ella") | `src/lib/ella.ts` | Reads a message, works out what is being asked, writes a draft from the product record and the approved answers. No AI service, no cost. |
| Send rules | `src/lib/sendrules.ts` | The 24-hour DM window, the 7-day and once-per-comment private reply rule, draft-only mode. |
| Workflow | `src/lib/inboxService.ts`, `src/lib/inbox.ts` | Pull from the relay, store, draft, approve, send. Tables `ig_events`, `ig_drafts`, `ig_state`. |
| Connections | `src/lib/providers/relay.ts`, `providers/instagram.ts` | The only code that talks to the relay and to Instagram. The access token lives only in the second one. |
| Settings | Settings page | Shows whether the relay, token and live sending are set. Never shows a value. |

How a message is handled:
1. It arrives (pulled from the relay every minute while the page is open, or pasted in by hand).
2. The writer picks the piece: one you chose, a name or SKU in the message, or what this customer was last talking about.
3. It drafts a reply. Price, sizes, availability, care and material answers come only from the product record and `KNOWLEDGE_BASE.md`.
   Shipping, returns, discounts, orders, custom work, complaints and skin reactions are never answered: the draft is a short holding
   message, the customer is flagged **needs you**, and a complaint on a public comment gets no public reply at all.
4. You edit if you like and press **Approve**. The text is checked again for banned wording at that moment.
5. Draft-only mode (default): the reply is marked approved and you copy it into the Instagram app, then press **I sent it**.
   Live mode (`IG_SEND_MODE=live`): the Studio sends it, once, and refuses a second press.

Asked "are you a bot?", the reply says she is the shop's virtual assistant and offers the owner.
The inbox works today with no Instagram connection at all: paste in a message you read in the app and get a draft.

## Safeguards (tested end to end)

- **Other websites cannot press the Studio's buttons.** `src/middleware.ts` refuses any change that comes from another site, and any
  request that reaches the Studio under a name other than localhost (DNS rebinding). This also protects delete and upload. Set
  `EFJ_ALLOWED_HOSTS` if you deliberately open the Studio under another name. `npm run dev` listens on this computer only.
- **A reply is never sent twice.** Pressing send twice, or two tabs, send once. If Instagram's answer is lost (timeout, dropped
  connection), the reply is marked **check Instagram** instead of being retried, and you choose "I sent it" or "Try again". A send
  interrupted for over two minutes is recovered the same way. Rewriting drafts never creates a second private reply to a comment.
- **Banned wording cannot be sent.** The text is checked again at the moment you press send, whatever was typed into the box.
- **Instagram's limits are respected.** No API reply after 24 hours, a private reply to a comment only once and within 7 days,
  and a reply to a reply-comment goes under the top-level comment.
- **The token stays put.** It is sent only to Instagram's own hosts, in a header, and removed from any error text. No page or
  response ever contains it.
- **A reset relay is noticed.** The relay stamps its database with an id. If the database is wiped, the Studio sees a new id and
  starts reading from the beginning, so new messages are not skipped. Run the relay with `SqliteStore` (`node relay/server.ts`).
  The in-memory store forgets everything on restart and on every cold start of a serverless host, so it is for tests only.
- **One bad message cannot block the rest.** A message that cannot be drafted is flagged for you and the sync carries on.

## What is not built yet

1. **Meta setup.** Business account, developer app, app review for messaging permissions. This takes weeks and is the real critical path.
2. **Hosting the relay.** Pick a host, set the three secrets, point Meta's webhook at `https://<host>/webhook`.
3. **Post to product matching.** Comments carry a media id, but nothing yet records which product each post showed. Until Phase 3
   publishing stores that link, comments are matched by name or SKU in the text, or you pick the piece.
4. **A smarter writer (optional).** The writer is rule based, so it is predictable and free but cannot handle unusual phrasing.
   Unclear messages are flagged for you instead of guessed. Claude subscription access cannot power an app. A Claude API key
   with `claude-haiku-5-5`, or Gemini, could rephrase the same approved facts later, still through the banned-wording check.
5. **Real-world check of live sending.** The send step is tested against a mock of Instagram that records what it receives. Test one real
   reply with a test account before trusting it, because Meta's exact request rules can change.

## Rules the Inbox must follow
- Answer only from the product record and `KNOWLEDGE_BASE.md`. Anything marked [CONFIRM] goes to you.
- Every draft passes `claimProblems` / `scanText`. A failing draft is not sent, it is flagged.
- Say she is the shop's virtual assistant when asked (see Ella in BRAND.md).
- Reply inside Meta's 24-hour window. Comment replies get one private reply per comment, within 7 days.
- Skin reactions, refunds, damaged orders and angry customers always go to you.
- Start in draft-only mode for a week before any auto-send.

## Running the relay

```
RELAY_APP_SECRET=<instagram app secret>[,<meta app secret>]
RELAY_VERIFY_TOKEN=<long random string, at least 24 characters>
RELAY_PULL_TOKEN=<another long random string, at least 24 characters>
node relay/server.ts
```
Use HTTPS in front of it (Meta requires it). Any host that gives you a certificate works. Never reuse the two tokens, and keep them out of git.

## Publishing a post (`npm run ig:publish`)

Publishes a finished kit from `npm run insta` (`instagram/<product>/`) to the shop's account. Needs `IG_ACCESS_TOKEN` and
`IG_USER_ID` in `.env.local`, the Studio running (`npm run dev`), and `cloudflared` installed (`winget install Cloudflare.cloudflared`).

```
npm run ig:publish -- clover-set                 # dry run: shows the images, caption, hashtags, alt text and Story. Sends nothing.
npm run ig:publish -- clover-set --caption 2     # use the second caption in the post notes (default: the first)
npm run ig:publish -- clover-set --confirm       # publish it
npm run ig:publish -- --tunnel-test clover-set   # check the tunnel can serve an image to the internet. Posts nothing.
```
Other options: `--single` (main photo only instead of a carousel of main + close-up), `--no-story`, `--story-only`, `--again`.

- **What is posted.** A carousel of the 4:5 main image and the 4:5 close-up, with the chosen caption plus the hashtags and the
  alt text for each slide, then the Story image as a Story. The square image is for Facebook and WhatsApp, not this post.
- **Nothing goes out with blanks or banned wording.** Any `[BRACKET]` left in the caption, hashtags or alt text, or anything
  `claims.ts` flags, stops the script. The Studio's publish route checks again.
- **How Instagram gets the images.** Instagram downloads each photo from a public https address. For one publish only, the script
  copies the JPEGs to a temp folder under random names, serves just those files from a tiny server on 127.0.0.1 (GET of those exact
  names, nothing else), and opens a Cloudflare quick tunnel to that server alone. The Studio is never exposed. Tunnel, server and
  temp folder are removed afterwards, also after an error or Ctrl+C. Your PC must stay on until the script finishes.
- **Never posted twice by accident.** Each result is saved in `instagram/<product>/<product>_published.json` with the media id and
  link. A kit that is already there is refused unless you add `--again`. If Instagram gives no clear answer to the final publish
  step, it is not retried: it is saved as `check-instagram`, so look at the account before trying again.
- **The token** stays in the Studio (`src/lib/providers/instagram.ts`), in a header. The script holds no keys.
- To check the token: open http://127.0.0.1:3000/api/inbox/instagram-check (read-only: account name and posting quota).
