# Knowledge Base — 10K Gold-Plated Jewellery

The DM bot answers **only** from this file plus each product's record.
Anything marked **[CONFIRM]** must be filled in by the owner before the bot goes live.
Until it's filled in, the bot hands that topic to a human.

---

## 1. Store facts (fill in)

| Fact | Value |
|---|---|
| Base metal under the plating | [CONFIRM: brass / stainless steel / sterling silver / copper, per product] |
| Plating thickness | [CONFIRM: e.g. 0.5 µm / 1 µm / 2.5 µm, ask your supplier] |
| Nickel-free? Lead-free? | [CONFIRM: only claim with supplier certificate] |
| Anti-tarnish / e-coating? | [CONFIRM] |
| Ring sizes offered / adjustable | [CONFIRM] |
| Chain lengths offered | [CONFIRM: e.g. 16", 18", 20" + extender] |
| Shipping within BC / Canada (price, days) | [CONFIRM] |
| Free shipping threshold | [CONFIRM] |
| Local pickup / delivery in Metro Vancouver | [CONFIRM] |
| Ships to USA? | [CONFIRM] |
| Payment methods | [CONFIRM: card via payment link, Apple/Google Pay, Interac e-Transfer] |
| Return / exchange window | [CONFIRM: e.g. 14 days, unworn, earrings final sale for hygiene] |
| Warranty on plating | [CONFIRM: e.g. 30 days against defects] |
| Gift box included? Gift note? | [CONFIRM] |
| Response time for human replies | [CONFIRM] |

## 2. Approved answers

### "Is this real gold?" / "Is it solid gold?"
It's **10K gold-plated**: a layer of 10K gold bonded over a [base metal] core.
It is not solid gold. That's why it's priced as fashion jewellery. You get the
warm gold look for everyday wear.

### "What does 10K mean?"
Karat (K) measures gold purity out of 24. 10K means 10 parts gold out of 24
(about 41.7% gold), mixed with other metals. That makes it harder-wearing and a
bit softer in colour than 14K or 18K. On our pieces, the 10K gold is the
*plating* layer.

### "Will it tarnish / fade?"
All plated jewellery wears over time. How fast depends on how often you wear it
and what it touches. With care, it keeps its shine much longer (see care tips).
Never promise a number of months or years unless the owner has set one.

### "Can I shower / swim / work out in it?"
We recommend taking it off before showering, swimming (pools and the ocean),
hot tubs, saunas and workouts. Water, chlorine, salt and sweat wear plating faster.
**Never say "waterproof".**

### "Is it safe for sensitive skin?"
Answer only from the product's `nickel_free` / `hypoallergenic` fields. If they're
unknown: "I don't want to guess on this one. Let me check with our owner and get
back to you." Then hand off to a human.

### "Will it turn my finger green?"
Some base metals (like brass or copper) can react with skin, sweat or lotion and
leave a temporary mark once the plating wears. It washes off and isn't harmful.
Keeping the piece dry and applying lotion before putting it on helps.

### Care tips (standard)
1. Put jewellery on **last**, after lotion, perfume and hairspray.
2. Take it off **first**: before showering, swimming, the gym and sleep.
3. Wipe it with a soft, dry cloth after wearing.
4. Store each piece separately in its pouch or an airtight bag. Vancouver's
   damp air speeds up tarnish.
5. No jewellery cleaners, toothpaste or ultrasonic cleaners. They strip plating.

### Sizing
- Rings: ask for their usual size. If unsure, suggest wrapping a strip of paper
  around the finger, measuring the length in mm and sending it. The bot maps it
  using the ring size chart in the product data. Mention if the ring is adjustable.
- Chains: describe where each length sits (16" collarbone, 18" just below,
  20" upper chest). Mention the extender if there is one.
- Bracelets: wrist measurement + 1–2 cm for comfort.

### Gold-plated vs gold vermeil vs gold-filled vs solid gold
- **Gold-plated**: a thin layer of gold over a base metal. Most affordable. *(What we sell.)*
- **Gold vermeil**: a thicker gold layer over sterling silver.
- **Gold-filled**: a much thicker gold layer pressure-bonded to the core. Lasts longer.
- **Solid gold**: gold alloy all the way through. Most expensive.
Be neutral and factual; don't run the others down.

### Ordering, payment, shipping, returns
Answer from Section 1 only. The bot never makes up delivery dates, discounts
or policy exceptions.

## 3. Always hand off to a human

- Damaged, wrong or missing order; any refund request
- Skin reaction or any health concern
- Custom orders, engraving, bulk or wholesale, influencer or collab requests
- Discount negotiation beyond published promos
- Angry or upset customer, or a complaint on a public comment
- Any question the bot can't answer from this file or the product record
- The customer asks for a person

## 4. Compliance guardrails (Canada)

- **Precious Metals Marking Act & Regulations:** plated items must be described
  as plated (for example "10K gold-plated" / "10K GP"), never as "10K gold". Check
  any quality marks stamped on the piece against the regulations.
- **Competition Act:** advertising must not be false or misleading. AI-generated
  images must show the real product accurately.
- **CASL:** don't send promotional DMs or emails to people who haven't opted in.
  Replying to a customer's question is fine.
- **PIPEDA:** collect only what's needed for the order (name, address, phone,
  email). Store it securely.
