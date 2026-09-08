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

> Roughly 8 in 10 US medical bills are estimated to contain errors, and the document that would
> prove it — the Explanation of Benefits your insurer sends — arrives separately, weeks apart,
> in a format designed to be filed rather than read. Nobody puts them side by side.
>
> This puts them side by side. You upload the itemized bill and the EOB, and it reports what
> disagrees: a line billed twice, a charge above the amount your plan allowed, a service on the
> bill that the EOB never adjudicated, or the EOB's own arithmetic not adding up. If you also
> upload your Summary of Benefits once, it checks the bill against what your plan promised —
> the $60 copay billed as $175 case.
>
> Worth addressing, since it landed the week before this post: OpenAI connected ChatGPT to Epic.
> It reads the clinical chart — notes, labs, medications — read-only, and mostly for clinicians. It
> does not reach billing, and that is not an oversight waiting to be patched. A billing error does
> not exist inside either document; it exists in the difference between two documents held by two
> different organisations. Your provider issues the itemized statement. Your insurer issues the EOB,
> weeks later, separately. The chart has neither, and even the itemized bill usually lives in a
> billing module rather than the clinical record. The closest thing in that announcement is a CMS
> Coverage lookup, which tells you what Medicare covers in general — not what your hospital charged
> you in particular.
>
> Every finding quotes the line it came from, labelled BILL, EOB or SBC. That is enforced
> rather than encouraged: a finding whose quoted evidence does not appear verbatim in the
> source document is dropped before you see it. It is not a complete defence against a model
> being wrong, but it does mean you can check any claim in about two seconds, and that a
> confident-sounding invention with no source behind it never reaches the page.
>
> Some things I found building it that I did not expect:
>
> **Extracting text in the browser was making it worse.** It originally parsed the PDF text
> layer and sent that. Now every document — PDF, phone photo, scan — is rendered to page images
> and the model reads those. I expected to pay for it in accuracy and didn't: the same bill as
> a digital PDF and as a 110 DPI PNG returns identical figures, to the cent. It also deleted a
> whole category of bug, because column association in a table does not survive `pdftotext`.
>
> **The hard part is not finding errors, it's not inventing them.** Pairing a bill with the
> wrong EOB makes a perfectly correct bill look like fraud — every line comes back "missing
> from the EOB." The worst version is a household: two family members, same clinic, same day,
> same procedure code, and the only thing separating the statements is the patient name on the
> claim line. The subscriber block names the same person on all of them, so a document-level
> name check passes and you confidently tell someone to dispute a charge they owe. It now
> compares claim-level names and says so plainly: "This EOB is for someone else."
>
> **Plan limits are per member, not per household.** "6 outpatient mental health visits per
> year" pooled across a family of two with 3 visits each reads as "limit reached — further
> visits may be your responsibility." That is the worst thing the tool can say, because it
> costs care rather than money.
>
> Stack: static frontend, Firebase, Gemini on Vertex AI. Findings are structured output against
> a JSON schema, and the totals de-overlap so a finding contained inside a larger one is not
> counted twice — an early version reported more money at stake than the bill was for.
>
> **What it doesn't do:** it is not a law firm and does not represent you. It won't contact your
> provider or insurer and it won't file anything on your behalf — it shows you the findings and the
> lines they came from, and what you do with those is yours. And your bill and EOB go to
> Google's Gemini models on Vertex AI with your name and everything else printed on them
> intact. There is no on-device redaction; I tried, the model I used for it was broken in a way
> that silently passed everything through, and shipping a privacy feature that doesn't work is
> worse than not having one. That tradeoff is stated on the upload screen before anything is
> sent, and you can delete any audit or the whole account at any time.
>
> Free, 10 audits a day, because each one is a real model call I pay for. There is a sample audit
> you can read without an account — a real run on a synthetic bill, findings and quoted evidence
> and all. Running your own needs one, because the results are stored under your uid.
>
> I would especially like to hear from anyone who runs it on a real bill and gets a wrong
> answer. False positives are the failure that matters here — telling someone to dispute
> something they owe is worse than missing an error — and I have no way to measure them yet.

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
