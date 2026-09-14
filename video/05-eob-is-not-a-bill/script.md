# 5. Your EOB is not a bill — so what is it?

**Target:** 3:15–3:45 · **Spoken words:** ~520 · **Tier:** learning · **Shoot:** first

**Search intent.** Someone has a page from their insurer with dollar amounts on
it and does not know whether they are supposed to pay it. They are not angry yet.
They are trying to work out whether they owe $189.

**The one idea.** It is a receipt, not an invoice. The number on it is what you
will later check the real bill against.

**Title to publish:** `Your EOB is not a bill — here's what it actually is`
Jargon in the title because that is what gets typed. Not a word of it in the
first line spoken.

---

## Source document

`test-fixtures/carrier/eob-cigna-sample.pdf`.

**Attribute it on screen.** This is *Cigna's own guide* to reading an EOB, with a
sample claim inside it — not a member's statement. Say so. It is published for
member education, so showing it is fine; passing it off as somebody's real EOB is
not, and the annotations in the margin are Cigna's, not ours.

The figures, all printed on page 1:

| Line | Value |
|---|---|
| Amount billed | **$189.00** |
| What I owe | **$11.89** |
| You saved | **$177.11 (or 94%)** |
| of which negotiated discount | $70.05 |

The sample claim is dated 11/09/2015. Do not zoom on the date, and do not hide
it either — if it is legible, say "this is their published example, a few years
old now" and move on. Pretending not to notice is worse than mentioning it.

---

## Beats

### 0:00 — Hook
**Screen:** The EOB, full page, still. No cursor movement yet.

**Say:**
> If you've got a page from your insurance company with dollar amounts printed on
> it, and you're not sure whether you're supposed to pay it — this is for you.
> It's called an Explanation of Benefits. And the single most important thing
> about it is that it is **not a bill**.

### 0:12 — The obvious question, answered immediately
**Screen:** Cursor circles the dollar figures without settling on one.

**Say:**
> So why has it got money all over it?
>
> Because it's a receipt. It's the record of a negotiation you weren't part of —
> between your doctor and your insurance company — about what your visit actually
> costs. You're being shown the result after the fact.

### 0:30 — Number one, alone
**Screen:** Cursor rests on **Amount billed $189.00**. Nothing else highlighted.

**Say:**
> Here's the first number. Your doctor asked for a hundred and eighty-nine
> dollars. That's the starting price — and for most people with insurance, it is
> not the price that gets paid. Think of it the way you'd think of the sticker
> on a car.

### 0:52 — Number two
**Screen:** Cursor moves down to **What I owe $11.89**. Hold. Let it sit.

**Say:**
> And here's the last number on the page. Eleven dollars and eighty-nine cents.
>
> That's the gap. A hundred and eighty-nine at the top, eleven eighty-nine at the
> bottom — and everything in between is the page explaining how it got from one
> to the other.

### 1:15 — What happened in between
**Screen:** Cursor traces **You saved $177.11 (or 94%)**, then the $70.05
discount line.

**Say:**
> Two things happened. Your insurer had already agreed a lower price with that
> doctor — that's the discount, seventy dollars of it here. And then the plan paid
> its share of what was left.
>
> Add those together and it's a hundred and seventy-seven dollars you're not being
> asked for. Which is genuinely the good news on this page.

### 1:45 — The turn
**Screen:** Pull back to the whole page.

**Say:**
> But here's why I said this isn't a bill.
>
> Nothing on this page is asking you for money. There's no "pay by" date. There's
> no payment slip. Your insurance company doesn't bill you — your doctor's office
> does, separately, and that envelope usually turns up later.

### 2:05 — The actual instruction
**Screen:** Cursor returns to **$11.89** and stays there.

**Say:**
> So here is the only thing you have to do with this page: **keep it, and
> remember this number.**
>
> When the real bill arrives from your doctor's office, it should be asking for
> about that. If it asks for a hundred and eighty-nine — the starting price — then
> something has gone wrong, and that's worth a phone call.
>
> That is the whole job of this document. It tells you what the bill is supposed
> to say before the bill turns up.

### 2:35 — What it does not tell you
**Screen:** Still on the EOB.

**Say:**
> Two things it won't tell you. It won't tell you whether you needed the care —
> that's between you and your doctor. And it won't tell you whether the treatment
> was written down with the right code, which is a different video.
>
> It tells you the price. That's it. But the price is usually where the mistakes
> are.

### 2:55 — The tool, once
**Screen:** Cut to `/app?sample=1`, the four totals cards.

**Say:**
> I built a free thing that does this comparison for you — you give it the bill
> and this letter, and it tells you where they disagree. It's at
> useclaimright.com, it's free, and there's nothing to sign up for to look at the
> example.
>
> But you don't need it for this. You need to know the page isn't a bill, and
> you need to keep the number at the bottom.

### 3:10 — Disclaimer, on screen and spoken
**Screen:** Plain card, high contrast, held for the full read.

**On screen, verbatim:**
> This is general information, not legal or medical advice. Always check figures
> against your own documents before disputing a charge.

**Say:**
> This is general information, not advice — check your own paperwork before you
> argue with anyone about a charge.

---

## Notes for the edit

- **No music.** Nothing here needs energy; it needs to sound like someone
  explaining a form to a friend.
- **Cursor is the pointer, not a fidget.** It should be still except when moving
  deliberately to the next figure. Jitter reads as nervousness.
- **Read the numbers aloud as words** — "a hundred and eighty-nine dollars", not
  "one eight nine". The viewer is looking at their own page, not ours.
- **The 0:52 pause is the video.** Two numbers, far apart, on one page. Let it
  land before explaining it.
- **Chapters** at 0:30, 1:45 and 2:05 — the three things a searcher might have
  come for.

## Words that must not appear

From `docs/CONTENT.md`: adjudicated, accrues, cost-sharing, network write-off,
balance billing, allowed amount. *Allowed amount* is video 4 and saying it here
costs thirty seconds explaining it.

## Open question before shooting

Whether to say "your doctor" or "your provider" throughout. This draft says
doctor, because it is the word people use — but the same page covers labs,
hospitals and imaging centres, and a viewer whose bill is from a hospital may
feel spoken past. Worth one test read both ways.
