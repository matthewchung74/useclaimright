# Launch framing

The TODO this replaces said "the Show HN framing is stale — the CEO plan's launch pitch was
built on the on-device redaction hook, which no longer exists." That is true, and worse: the
plan it referred to (`2026-08-20-launch-and-appeal-letter.md`) was never tracked in git, so
there was nothing to correct. Written fresh here, against what the product actually does as of
2026-09-07, and kept in the repo so it goes stale visibly next time.

**What changed under the old pitch.** It led on on-device PHI redaction — the bill was scrubbed
in your browser before anything was sent. That model was removed on 2026-08-23 because it did
not work (see `docs/upstream-bug-openmed-onnx.md`: the fp16 and q4f16 variants failed to load
and the q8 variant returned near-chance logits, which is the dangerous failure — it looked
fine and redacted nothing). Leading a launch on a privacy feature that had never functioned
would have been the worst possible thing to be caught on.

The honest pitch is better anyway, because the product got more interesting: it reads both
documents as images, cross-checks them line by line, checks both against your plan, and quotes
its evidence for every claim.

---

## Show HN post

**Title:** `Show HN: UseClaimRight – Cross-check a medical bill against your insurer's EOB`

*(HN titles: no exclamation, no "AI-powered", under 80 chars. The verb "cross-check" is the
product; "audit" reads as accounting software.)*

**Body:**

> My hospital bill and my insurer's EOB turn up weeks apart, in different envelopes, and nobody ever puts them next to each other. That gap is where billing errors live.
>
> So: upload the itemized bill and the EOB, and it tells you what disagrees — a line billed twice, a charge above what your plan allowed, something on the bill the EOB never processed, or the EOB's own numbers not adding up. Add your Summary of Benefits once and it checks the bill against what the plan actually promised too.
>
> Every finding quotes the line it came from. That's enforced, not encouraged: if the quote isn't verbatim in your document, the finding is dropped before you see it. Doesn't make the model right, but you can check any claim in about two seconds.
>
> Two things surprised me building it.
>
> Reading the PDF text layer was making it worse. Everything's rendered to page images now and the model reads those. The same bill as a digital PDF and as a 110 DPI scan comes back identical to the cent — and table columns survive, which pdftotext reliably destroys.
>
> The hard part isn't finding errors, it's not inventing them. Pair a bill with the wrong family member's EOB and every line comes back "missing from the EOB" — a perfectly correct bill that looks like fraud. Same clinic, same day, same code, and only the patient name on the claim line tells them apart. The subscriber block names the same person on all of them, so a document-level name check sails right past it. It compares claim-level names now and just says "This EOB is for someone else."
>
> On ChatGPT + Epic, since that landed last week: it reads the clinical chart. A billing error isn't in the chart — it's in the gap between your provider's bill and your insurer's EOB, and neither party holds both.
>
> Free, 10 a day, because each one is a real model call I pay for. There's a sample audit you can read without signing up.
>
> Your documents go to Gemini on Vertex AI with your name still on them. No on-device redaction — I tried, the model I used silently passed everything through, and a privacy feature that doesn't work is worse than none. That's said on the upload screen before anything is sent.
>
> I'd most like to hear from anyone who runs a real bill through it and gets a wrong answer. False positives are the failure that matters here — telling someone to dispute something they do owe is worse than missing one — and I've got no way to measure them yet.

*Shortened 2026-09-08 from ~4,850 chars to ~2,400, and loosened. The long version
explained; this one just says the thing. Cut: two of the three build notes, the stack
paragraph, and most of the hedging. The Epic point went from a paragraph to two lines —
it earns a mention, not an essay, and at that length it cannot read as picking a fight.*

---

## The flow video

`web/img/flow.mp4` (484KB) + `flow.webm` (331KB) + `flow-poster.jpg` — 762×480, 19.2s, in `#how`
beside the three steps, which highlight in time with it.

**A video rather than a GIF, and the reason decides it.** A GIF exposes no playback state — no
`currentTime`, no events, no way to know when it started or where it is in its loop — so the step
highlighting could only be guessed at with a timer, and the guess drifts the moment a load is slow
or a tab is backgrounded. `timeupdate` is exact and self-correcting. It is also about five times
smaller than the same footage as a GIF, which matters where acquisition is organic and mobile.

**Recorded 2026-09-08 against production**, driving a real audit on `sample-bill.pdf` +
`sample-eob.pdf` with the Acme Silver PPO plan on file. The run produced $2,115.00 / $841.75 /
$186.35 / **$842.39**, and `web/sample-audit.json` is that same audit — so the video and
`/app?sample=1` end on identical numbers rather than two versions of the truth. Editing is limited
to trimming dead air (82s to 19.2s, including 40s of spinner) and cutting two macOS file-picker
windows that showed the recorder's home directory. No overlays, no watermark, no invented frames;
the absence of the picker is verified by a luminance scan of the output rather than by eye.

**Still the most drift-prone artifact in the repo.** Nothing fails when the UI moves on. Re-record
when the upload form, the review screen or the report visibly changes — and if you are reading this
note long after that happened, the video is already lying. The step timings in `index.html`
(`data-at` on each `.step`) are cut points in this specific file and must be re-derived with it.

---

## LinkedIn post

Different audience, opposite rules. HN punishes a post that opens on a competitor; LinkedIn rewards
a timely structural take on news people are already reading about. So this one *does* lead with the
Epic integration, keeps the product to a closing line, and stands up as an observation even for
someone who never clicks.

**Body:**

> OpenAI connected ChatGPT to Epic last week. I tried it on my own records and it is genuinely good
> — it read my history, my labs and my medications, and gave me a clearer summary than any portal
> ever has.
>
> Then I asked it about a bill.
>
> It has no access to one, and that gap is not closing soon, because of where the data lives.
>
> Your clinical record sits with your provider. Your Explanation of Benefits — the document that
> says what your insurer actually allowed — arrives from your insurer, weeks later, in a separate
> envelope. A billing error is not in either document on its own. It is in the difference between
> them.
>
> The nearest thing in OpenAI's announcement is a CMS Coverage lookup: what Medicare covers, in
> general. Genuinely useful. It cannot tell you whether your hospital charged you correctly.
>
> Here is what that gap looks like in practice. On one $2,115 emergency-room bill: a lab test billed
> twice at $145.50, $658.65 charged above what the plan allowed, and my favourite — the insurer's own
> EOB did not add up. Its per-line amounts summed to $168.35 while the same page stated $186.35. An
> $18 arithmetic error on the document you are supposed to trust.
>
> None of that is visible from the chart. All of it is visible the moment the two documents sit side
> by side.
>
> That is the whole product: useclaimright.com — free, and you can see a sample audit without an
> account.

### Before posting this

- **Check the timing words.** "Last week" is only true for a few days. Say the date or drop it.
- **Keep the claim narrow.** The Epic integration is read-only, clinical, and largely
  clinician-facing. Do not say ChatGPT "cannot read documents" — it can, if you paste them. The
  accurate claim is that the *integration* connects to records rather than to billing.
- **The $18 finding is the hook.** It is specific, checkable, and surprising in a way "we find
  errors" never is. Keep it concrete; drop the adjectives before you drop the number.

## Why this framing

**Lead with the document nobody reads.** The insight is not "AI reads your bill"; it is that
the evidence to dispute a bill already exists, in the mail, and no one cross-references it.
That is a real observation and it survives the AI hype cycle.

**The interesting-failures section is the post.** HN rewards being specific about what went
wrong. The wrong-family-member case, the text-extraction reversal and the per-member limit are
all concrete, all counterintuitive, and all true. They also demonstrate care without claiming
accuracy the product cannot prove.

**State the privacy tradeoff before anyone asks.** A health product sending named documents to
a third-party model will be asked about it in the first ten comments. Saying it first — and
admitting the redaction attempt failed and was pulled — converts the single biggest objection
into evidence of honesty. Hiding it invites the thread to be about that and nothing else.

**Ask for false positives.** It is a genuine open problem (`per-finding feedback` is still an
open TODO and is the only way to measure them), it invites the exact contribution HN is good
at, and it sets expectations that the tool can be wrong.

## Do not say

- "AI-powered" anywhere. The post shows what it does.
- Any recovery figure or success rate. There is no data behind one, and inventing it on a
  medical-billing product is the fastest way to deserve a bad thread.
- "Save thousands." Same reason.
- That it is HIPAA-compliant. It is not a covered entity; the frame is the FTC Health Breach
  Notification Rule, and that conclusion has not been reviewed by an attorney either.

## Before posting

- [ ] **The no-upload sample audit** (open TODO). A visitor currently has to create an account
      before seeing anything work, and an HN spike lands on a sign-in wall. This is the single
      highest-leverage thing to build first.
- [ ] Confirm the 10/day cap and the `meta/guard` spend guard survive a front-page spike, and
      know what the ceiling costs. An audit is ~$0.01, so 2,000 of them is ~$20.
- [ ] Be at the keyboard for the first few hours. An unanswered Show HN dies.
