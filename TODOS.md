# TODOS

Deferred items with context. Created by /plan-ceo-review 2026-08-20.

## From the eng review (2026-08-23-phase0-phase1.md)

- [ ] **One patient per account, throughout.** The roster + `patientRef` fixes
      cross-bill duplicate detection, but the assumption runs deeper: tracker
      limits ("6 therapy visits per year") are per person, not per household,
      and `deductibleToDate` on a family plan has separate individual and family
      amounts the current model cannot represent. Families are the common case
      for surprise bills.
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
- [ ] **Scan-line sweep during redaction** (DESIGN.md motion spec). The download
      progress UI already ships (`app.js:433/508/1422`); this is the polish on
      top.
- [ ] **Enumerate verified charges on a clean result.** Today: "No discrepancies
      found" (`app.js:908`). Better: "We checked 14 charges against your EOB and
      your plan." Most bills are correct, so this is most of your volume.
- [ ] **`web/privacy.html:52`** says "limit access to those working on your case"
      — service-relationship language on a self-help tool. Fix before a Stripe
      account exists. Codex also flags `privacy.html:60` still calls itself a
      placeholder requiring attorney review, and `:36,48` promise documents are
      used solely for the user's own analysis, which the Billing Error Index
      would contradict.
- [ ] **`functions/index.js:170`** writes both redacted documents plus findings
      into a single Firestore doc against the 1,048,576-byte limit. The write
      happens after the model is billed, so a breach means the user pays and gets
      an error. One-line guard.
- [ ] **No-upload sample audit** (Codex suggestion). Let visitors see a result
      before signing in and downloading 500MB.
- [ ] **Per-finding feedback** (Codex suggestion): correct / incorrect / unclear /
      "provider corrected this". The only way to measure false positives.

## Design doc items (mattc-main-design-20260817-120538.md)

- [ ] Prefetch the NER model on landing-page hover/idle.
- [ ] Mobile gate with explicit messaging — HN front-page traffic is ~half mobile.
- [ ] Decide the no-model path (server-side or regex-only) for mobile and
      impatient desktop visitors. This is a privacy tradeoff, not a task.
- [ ] `MAX_DOC_CHARS` 200k -> ~60k with truncate-with-warning, not the current
      hard reject at `index.js:109`.
- [ ] `maxOutputTokens` + thinking budget, with `finishReason: MAX_TOKENS` treated
      as terminal, not retried (the retry at `:137` would double cost).
