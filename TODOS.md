# TODOS

Deferred items with context. Created by /plan-ceo-review 2026-08-20.

## From running the suite on production (2026-08-25)

- [ ] **Two sign-in links are 15px tap targets.** "Create an account" and
      "Forgot password?" are inline text links in a `<p class="muted">` on the
      sign-in card — 15px tall at a 390px viewport, against the ~44px that is
      comfortable on a phone, and adjacent to each other so the wrong one is
      easy to hit. Found 2026-08-26 testing at a true phone viewport. Everything
      else interactive is 32px+. Worth batching with the DESIGN.md palette
      alignment rather than patching alone.

- [x] ~~**`billKey` cannot recognise the same paper across extraction methods**~~ —
      FIXED 2026-08-26. The model now extracts `statementId` — the account,
      statement or invoice number printed on the bill — and `billKeyOf` prefers
      it over the text hash, keyed with the provider so the same account number
      at two providers stays two papers.
      Why an identifier and not structured fields: provider, patient, date and
      codes are *identical* between "one bill audited twice" and "one visit
      billed on two statements", so no combination of them can separate the two.
      The number on the paper is the only thing that differs. And because the
      MODEL extracts it, a PDF and a photo of the same bill agree.
      Verified on production: t6 audited as a PDF and again as a 110dpi PNG both
      returned `ACCT-SER-006`; the stored bill text differed (406 vs 437 chars,
      which is what defeated the old hash) and both keys came out `s11659ffa`.
      The dashboard did not flag it.
      **Limitation, deliberate:** audits stored before this change have no
      `statementId` and still fall back to the text hash, so pre-existing false
      duplicates persist until those bills are re-audited — 30 of 32 audits on
      the test account. A bill that prints no identifier at all also still falls
      back to the hash; going silent instead would have switched the detector
      off for those bills entirely.
      `billKeyOf` moved from `app.js` into `crossbill.js` so it is unit-testable;
      six tests cover it, including the production regression.
- [x] ~~**`prompt()` on the email-link path**~~ — GONE 2026-08-26. Resolved by
      deleting the email-link sign-in path entirely: the link was never actually
      delivered (Firebase's DEFAULT sender, no SPF/DKIM), and it carried the last
      native dialog in the app. There is now no `prompt()`, `confirm()` or
      `alert()` anywhere in the client.
- [x] ~~**Stale copy on the processing screen:** "Everything up to analysis happens
      in your browser."~~ — DONE 2026-08-25. It was literally true (extraction IS
      local) but it sat on the screen shown *while the documents are in flight to
      Google*, so it read as a privacy promise at the exact moment it was least
      true. Now: "Reading the pages happened here in your browser. The analysis
      itself runs on Google's Gemini API — your documents are with it now."

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
      *Partly improved 2026-08-25:* the model backend moved to Vertex AI, so the
      data terms are contractual and tied to this project's own service account
      rather than to whether billing happens to be enabled on an AI Studio key's
      project. The attorney review is still needed; the posture it reviews is
      better. See `docs/SETUP.md` §8.
- [ ] **Tighten the Functions runtime service account.**
      `223366324716-compute@developer.gserviceaccount.com` holds `roles/editor`,
      which is how it can call Vertex at all. `roles/aiplatform.user` plus the
      Firestore access it actually needs would be the least-privilege version.
      Editor on the runtime SA is broader than anything the app does.
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
