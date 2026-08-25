# TODOS

Deferred items with context. Created by /plan-ceo-review 2026-08-20.

## From running the suite on production (2026-08-25)

- [ ] **`billKey` cannot recognise the same paper across extraction methods, and
      the image path made this much worse.** `app.js:1138` hashes normalised
      text, and its own comment anticipates the failure: two extractions of one
      document get different keys and `crossBillDuplicates` reports "the same
      visit is on two statements" for a bill that exists once. Whitespace and
      case normalisation covered the HTML-vs-PDF case it was written for. A
      scan now returns the MODEL'S TRANSCRIPTION, which differs from pdf.js
      extraction by far more than spacing, so auditing one bill as a PDF and
      again as a photo reliably produces a false duplicate. Reproduced on
      production. No clean fix: billKey must identify the PAPER, and anything
      derived from the charges would make the detector never fire at all.
      Candidates: a statement number or account number extracted verbatim, or
      accepting the limitation and warning when two audits share every charge.
- [ ] **`prompt()` on the email-link path** (`app.js:216`) is the last native
      dialog. It blocks the renderer like the six confirms did, so that path
      stays untestable by automation. Needs an input, not a yes/no.
- [ ] **Stale copy on the processing screen:** "Everything up to analysis happens
      in your browser." Literally true, written for the redaction era.

## From the eng review (2026-08-23-phase0-phase1.md)

- [x] ~~Family deductible and OOP targets hardcoded to individual~~ — DONE.
      See the note below for what the bug was.
- [ ] ~~(fixed, kept for context)~~ **Family deductible and OOP targets were hardcoded to the individual
      amount.** `web/js/plan.js:52` and `:58` read
      `structured?.deductible?.individual` and `structured?.oopMax?.individual`.
      The plan schema DOES capture both individual and family (`plan.js:21-24`),
      so this is a display bug, not a data-model gap — an earlier note here said
      otherwise and was wrong. On a family plan the dashboard measures progress
      against the $500 individual deductible while the EOB accumulator counts
      toward the $1,000 family one. Reproducible with any file in
      `test-fixtures/real-sbc/` — all three are Coverage for: Family, $500/$1,000.
- [ ] **One patient per account (identity).** The roster + `patientRef` fixes
      cross-bill duplicate detection; tracker visit limits ("6 therapy visits per
      year") are still counted per account rather than per person.
- [ ] **FTC Health Breach Notification Rule review.** Unredacted PHI now goes to
      a third party. `privacy.html:60` already says the policy needs attorney
      review; that review is more load-bearing than it was.
- [ ] **The Show HN framing is stale.** The CEO plan's launch pitch was built on
      the on-device redaction hook, which no longer exists.

## From the CEO plan (2026-08-20-launch-and-appeal-letter.md)

- [ ] **`extractPlan` scope question.** The SBC plan-upload path is a second
      unbounded model call (`functions/index.js:76-86`, 3/day/uid) that appears
      in no wedge statement, no success criterion, and no part of the paid tier,
      while costing money, expanding attack surface, and carrying its own rate
      limit. Either it is core and belongs in the pitch, or it is carrying weight
      it does not earn. Decide before the next launch attempt.
- [ ] **DESIGN.md palette alignment.** Eight tokens ship at pre-design-system
      values: teal `#0d8a8a` vs spec `#087E78`, hover `#0a6d6d` vs `#056A65`,
      paper `#f4f8f9` vs `#F2F6F4`, ink `#0f2f3d` vs `#123232`, rule `#dbe7e9`
      vs `#C9D7D4`, muted `#3f5a66` vs `#607473`. Highlighter `#E8F25C` and
      success `#0A8A5F` already match. Deferred from P0 (fonts shipped, palette
      held) to avoid touching every screen with no visual regression tests.
- [x] ~~Scan-line sweep during redaction~~ — DROPPED. Redaction was removed
      2026-08-23; there is nothing to sweep.
- [ ] **Enumerate verified charges on a clean result.** Today: "No discrepancies
      found" (`app.js:908`). Better: "We checked 14 charges against your EOB and
      your plan." Most bills are correct, so this is most of your volume.
- [x] ~~`web/privacy.html:52` "those working on your case"~~ — DONE in c864fe3,
      along with the full policy rewrite. Still open: `:36,48` promise documents
      are used solely for the user's own analysis, which the Billing Error Index
      would contradict, and the policy has still had no attorney review.
- [x] ~~Firestore 1MiB document limit~~ — DONE in 9537147: stored text is
      trimmed to a 700k budget before the write.
- [ ] **No-upload sample audit** (Codex suggestion). Let visitors see a result
      before signing in and downloading 500MB.
- [ ] **Per-finding feedback** (Codex suggestion): correct / incorrect / unclear /
      "provider corrected this". The only way to measure false positives.

## Design doc items (mattc-main-design-20260817-120538.md)

- [x] ~~NER prefetch, mobile gate, no-model path~~ — all MOOT. The 500MB model
      was deleted 2026-08-23; there is no download and mobile works.
- [x] ~~`MAX_DOC_CHARS` and `maxOutputTokens`~~ — DONE in 9537147.
