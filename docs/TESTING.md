# Test Plans — SBC-first

The main case assumes the user has their **Summary of Benefits (SBC)** on file: setup once, then every audit is checked against the plan. Exception cases cover missing documents (no SBC, no EOB, wrong document). Each plan names its use case, exact fixture data, numbered steps, and ✓ checkpoints.

Fixtures: `test-fixtures/` (regenerate HTML: `node test-fixtures/gen-series.mjs` and `node test-fixtures/gen-family.mjs`; PDFs render via the browse CLI). Answer key: `test-fixtures/series-expected.json`. Pairings: `test-fixtures/README.md`.

Three fixture sets, and they are not interchangeable:
- **synthetic** (`fake-*.pdf`, `series/`) — planted errors with known answers. Most plans use these.
- **real** (`real-sbc/`, `real-eob/`) — genuine CMS and DOL documents. The only fixtures we did not write ourselves, and therefore the only ones that can tell us extraction works on something other than our own assumptions. Used by **P1**.
- **family** (`family/`) — a consolidated household EOB and three bills. Reproduces two defects fixed on 2026-08-23/24. Used by **FAM1–FAM3**.

⚠️ **Add the bill FIRST, in every plan.** Since 2026-08-27 the audit form opens showing only
step 1; the EOB dropzone appears once a bill is staged (E1b step 1). Any plan that says "upload
both" or "add all three" still works, but the bill has to land first — there is no EOB zone to
drop into before that.

**Session setup:** open https://useclaimright.web.app/app, hard-refresh, sign in. Two ways in — Google, or email + password — see **A1**. A fresh account starts empty with full daily limits (**10 audits, 3 plan uploads**).

**Budget — the full suite does NOT fit in one day.** Core plans (E1, M1–M6, D1, E2, E4–E7) cost **10 audits + 3 plan uploads**, exactly the daily ceiling, leaving no room for the rate-limit check. Optional **M7** adds 3 more. Run it as:

- **Day 1 (core):** E1 → **E1b** → M1 → M2 → M3 → M4 → M5 → M6 → D1, then the zero-cost plans (E3, E5*, R1, F1, R2). *E5 needs a plan upload.
  **E1b is not optional and not movable:** it costs no audits, but it starts from E1's report and ends by clearing the files M1 needs gone, so it only works in that slot.
- **Day 2 (edges):** M7, E2, E4, E6, E7, and the rate-limit check in Always-on.
- **Day 3 (auth, family, scans, real documents):** A1 (0 audits) → FAM1 (2 audits) → FAM2 (0, reads FAM1's) → FAM3 (0) → S1 (1 audit) → P1 (3 plan uploads) → G1 (0). Total **3 audits + 3 plan uploads**, so it fits comfortably and can be folded into Day 2 if Day 2 ran light.
- Or use **☰ → Reset account** between passes: it clears data and returns you to onboarding, but **daily counters intentionally survive**, so it does not buy more audits.

## Run log — what has actually been executed

One row per plan, and the only place to look for "have I done this?". **Update the date when you
run one.** A plan with no date has never been executed against the current build, whatever the
prose under it says — the per-plan notes that used to serve this purpose were scattered through
the file and easy to miss.

| Plan | Last run | By | Result |
|---|---|---|---|
| E1 | 2026-08-29 | agent | $2,115.00 / $841.75 / $186.35 / **$822.15** · `charity_care_eligible` did not fire (advisory, excluded from the total) |
| E1b | 2026-08-28 | matt | — |
| M1 | 2026-08-29 | agent | Acme Silver PPO on file, trackers auto-created 0/20 and 0/6 |
| M2 | 2026-08-29 | agent | $210.00 / $95.00 / $95.00 / **$150.00** · SBC quote present, tracker 1 of 20 |
| M3 | 2026-08-29 | agent | $175.00 / $120.00 / $120.00 / **$55.00** · no false positives (the control) |
| M4 | 2026-08-29 | agent | 2 audits, **$110.00** · per-audit `serviceDates`, consolidated EOB saved once |
| M5 | 2026-08-29 | agent | $175.00 / $0.00 / $175.00 / **$175.00** · tracker 4 of 6, no false mismatch warning |
| M6 | — | — | not run against this build |
| M7 | 2026-08-29 | agent | 3 audits · one-click tracker from an EOB remark, deductible $720.00 of $1,500.00 |
| D1 | 2026-08-29 | agent | 2 audits · duplicate hero on the re-bill, **and** no hero on the same statement twice |
| E2 | 2026-08-29 | agent | $175.00 / $0.00 / $0.00 / $0.00 · zero findings, no tab row |
| E3 | — | — | not run against this build |
| E4 | — | — | not run against this build |
| E5 | — | — | not run against this build |
| E6 | 2026-08-29 | agent | step 5: $2,115.00 / $0.00 / $845.00 / **$2,115.00**, warning on the post-run report |
| E7 | — | — | destructive; run last |
| X1 | — | — | one confirmation dialog seen incidentally during M7 |
| R2 | — | — | not run against this build |
| F1 | — | — | not run against this build |
| A1 | — | — | needs a throwaway account |
| FAM1 | 2026-08-29 | agent | 2 audits · Matthew and Sarah stayed two bills, no duplicate hero. Re-confirmed 2026-08-31: the dashboard now names them |
| FAM2 | — | — | **blocked**: needs a real SBC on file (family/individual split) and the family EOB as the most recent. The plan on file is `fake-sbc` and the deductible card is driven by the t-series EOBs, so the family-vs-individual arithmetic cannot be observed as written. |
| FAM3 | — | — | not run against this build |
| FAM3 | 2026-08-31 | agent | ✓ `matthew` and `family` stems disagree, still paired correctly (0 audits) |
| FAM4 | 2026-08-31 | agent | found a false positive ($85.00 on a correct charge, no warning) → **fixed and re-verified same day** |
| S1 | 2026-08-29 | agent | $2,115.00 / $841.75 / $186.35 / **$836.00** from a 110dpi PNG — identical to E1's digital PDF |
| IMG1 | 2026-08-29 | agent | 8 fixtures · HEIC refusal fixed, now covered by `test/browser` |
| P1 | — | — | not run against this build |
| G1 | — | — | not run against this build |
| PAY1 | 2026-08-26 | agent | sandbox cycle verified; payments are still **on** |
| REV1 | — | — | not run against this build |
| PHONE1 | 2026-08-29 | agent | 375px · 0 overflow, 0 controls under 16px, 44→2 short tap targets |
| TAP1 | — | — | not run against this build |

**The daily cap** was exercised on 2026-08-29: the 11th attempt showed the dialog and fired both
`limit_reached` and `error_shown`.

Two bugs were found by running this suite rather than by reading the code — the `statementId`
label false-duplicate and the empty saved EOB. Both are written up below.

## What you can reorder, and what you can't

Most plans are self-contained. The ones that aren't consume state an earlier plan produced, and
**they fail silently** — no error, just a plausible-looking wrong report. M5 read an EOB that a
previous plan was supposed to have saved and reported "no discrepancies found" on a $175 bill.
Check this table before jumping.

| Plan | Needs first | What breaks if you skip it |
|---|---|---|
| **E1** | **no plan on file** | The whole point is the honest "plan check didn't run" footer. Once M1 has run, E1 tests nothing — run it before M1, or after E3 removes the plan. |
| **E1b** | **E1, immediately** | Starts from E1's report and ends by clearing the files M1 needs gone. Not movable. |
| M2, M3, M4, M6, E2, D1 | **M1** (plan on file) | The plan-gate assertions all pass vacuously with no SBC. |
| E3 | M1 | Nothing to remove. |
| E5 | **E3** | Restores what E3 removed. |
| **M5** | **M4** (saves the consolidated EOB) | Auto-picks whatever EOB *is* in the library — a different provider's — and the missing-claim assertion becomes meaningless. |
| R2 | M4 | Needs any saved EOB in the library. |
| X1 | M1 + M4 + any audit | Needs an audit, a saved EOB, a plan and a tracker all present to have six things to delete. |
| M7 | **no mental-health tracker** | With an SBC on file the trackers already exist, so the one-click-from-remark path never appears. Delete that tracker first, or run without a plan. |
| FAM2 | **FAM1** | Reads FAM1's audits. |
| PAY1 | any audit **with findings** | A clean audit is free by design and cannot exercise the paywall. |
| E7 | **run last** | Destructive: wipes the account. |

Free to run in any order, no prior state: **E4, E6, F1, A1, FAM1, FAM3, S1, P1, G1, REV1, TAP1**,
the Firestore rules tests, and the Always-on checks.

**Before any plan that reads the EOB library, expand "My saved EOBs" and look at it.** A library
that is missing the EOB a plan expects — or holding one from a different provider — is the single
most likely reason a plan "passes" while asserting nothing.

**Zero-audit checks, before anything manual:**

```
npm --prefix functions test          # 175 pure-function tests
npm --prefix test/browser test       # 16 doc-drift + layout + extraction checks
```

`test/browser/` is the tier that used to be manual, and it is where **every stale claim found on
2026-08-29 lived**. It needs no sign-in and no audits: layout is a function of DOM and CSS, so
the authenticated screens are driven by unhiding them directly.

- `drift.test.js` ties a claim in this file to a fact in the source. A ✓ line saying "the 📷
  banner appears" fails once the `ocr-banner` element is gone. Records ("Verified on production 2026-08-25:
  the banner fired") are history and are left alone — only ✓ assertions are held to today's code,
  which is what lets a fix keep its own account of what it replaced. It found three stale
  assertions on its first run, one of which had been *noticed* the same day and not fixed.
- `ui.test.js` drives a real Chromium at 375×812 against `web/` served locally: horizontal
  overflow, controls under 16px, tap targets, the totals order, and image extraction.

**Add to `CLAIMS` in drift.test.js whenever a plan starts asserting something a grep can
confirm.** A missing fixture is a hard failure there, never a skip — the suite's own first run
"passed" two extraction tests in 0.18ms because `gen-by-plan.mjs` had wiped the folder they read
from, which is the exact failure this tier exists to catch.

**Automated tests first:** `cd functions && npm test`. Rules tests need the emulator + Java: `firebase emulators:exec --only firestore "npm --prefix functions test"`.

**Reading the totals tables:** every plan that spends an audit states its four totals cards in the same table — Billed, EOB allowed, Your responsibility, Worth disputing — with the arithmetic behind "Worth disputing" spelled out in the last column, followed by the findings that produce it. Amounts are model-extracted: treat them as ± a few dollars, but the **relationships must hold exactly** — Worth disputing equals its listed findings summed (nothing else folded in), and EOB allowed is $0.00 whenever there is no EOB.

**Moving between plans:**
- **Bills & coverage is home** — every sign-in lands there, and so does every batch. The audit form is reached from its "**Audit a new bill**" card; **the logo, top left, goes back** from anywhere. *(The three "← Back to bills" links were removed 2026-08-31: the logo already did the same job from every screen.)*
- From a **report** → **New audit** goes straight to the audit form and clears staged files, the saved-EOB selection, and any error (it's a full reset of the upload form, not of your data).
- From a **review** screen you don't want to analyze → **Start over** (costs no audit — use this whenever a plan says to back out).
- Already on the audit form → just scroll; nothing needs resetting.
- Staged files you no longer want → the **✕** on each row. Worth doing at the end of any plan that leaves files staged (E1b), so they don't follow you into the next one.

---

# Exception first (needs the no-plan state)

## E1 — No SBC on file: honest footer + core audit value
**Use case:** a user who skips plan setup still gets the full bill-vs-EOB audit, and the report admits the plan check didn't run.
**Data:** `fake-bill.pdf` + `fake-eob.pdf` (ED visit, planted errors).

1. A fresh account lands on the **onboarding screen** first: "Set up your plan" card (560px, teal top rule), payoff pitch with mono `$60`/`$175` figures, SBC dropzone with 📄, "What's an SBC?" explainer, and a centered "**Skip for now — audit a bill first**" link. Click **Skip**.
   ✓ The **Bills & coverage** page appears — this is home. The "**Audit a new bill**" card is the first thing on it, above "No bills audited yet…", so the primary action is never hidden behind the empty state. Scroll to "Your coverage": the **dashed one-line reminder** "No plan on file — add your Summary of Benefits · Add now" sits there (not a big card, not a gold banner).
2. Click **Start an audit →**. ✓ The audit form appears; **the logo is the way back**. **Step 1 is "Add your bill"** — the document the user actually has — and **step 2 is "Add the letter from your insurance, if you have it"**, with the "What's an EOB…" explainer under it. *(Reordered 2026-08-16: the EOB used to be step 1, putting eight elements and an acronym in front of the bill.)* Drag `fake-bill.pdf` onto the bill zone, `fake-eob.pdf` onto the insurance-letter zone. ✓ One "✓ file ✕" row under each zone.
3. Click **Prepare audit →**. ✓ Processing is quick — the pages are rendered locally, no model download. *(Was "the PDF's text layer is read directly" until 2026-08-29; PDFs are sent as page images and the browser reads no text layer.)*
4. Review both tabs. ✓ Left pane shows the rendered pages, right pane the extracted text under "What we'll analyze". Text matches the document; no placeholder chips anywhere (redaction was removed 2026-08-23).
5. Click **Looks right — analyze**.
   ✓ **The four totals cards** (observed 2026-08-10):

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$2,115.00** | sum of the bill's line items |
   | EOB allowed | **$841.75** | the plan's allowed amount |
   | Your responsibility | **$186.35** | what the EOB says you owe |
   | Worth disputing | **$822.15** | $145.50 duplicate + $658.65 billed-above-allowed + $18.00 cost-share error |

   ✓ **Duplicate charge** $145.50 — 80053 metabolic panel billed twice (occurrence table count 2).
   ✓ **Billed above EOB allowed** $658.65 — the bill demands ~$845 against $186.35 responsibility.
   ✓ **Charity care eligible** $186.35 — nonprofit-hospital financial assistance flag. Note it is deliberately **not** added into "Worth disputing": it's an avenue to pursue, not an overcharge, and adding it would double-count the responsibility figure.
   ✓ Sanity check: "Worth disputing" equals the duplicate plus the billed-above-allowed exactly. If it ever equals all three findings summed, that's a double-count bug.
   ✓ **Cost-sharing math error $18.00** — FIXED 2026-08-26, previously a known gap. The EOB
   states $186.35 owed while its own per-line amounts sum to $168.35. The prompt named
   `cost_share_error` but never asked the model to perform the check; it now says explicitly to
   add up the EOB's per-line patient-responsibility column and compare it against the stated
   total. The finding comes back with the arithmetic spelled out — "$8.24 + $4.55 + $124.00 +
   $27.70 + $3.86 = $168.35 does not equal the stated total responsibility of $186.35" — and
   quotes the EOB lines as evidence.
   ⚠️ **This changes E1's expected total.** Worth disputing was $804.15 and is now **$822.15**
   on a clean account ($145.50 + $658.65 + $18.00). The $18 does not double-count: $658.65 is
   the bill above the *stated* responsibility and $18 is the stated responsibility above the
   *true* one, and they sum to $676.65 = $845.00 − $168.35. With an SBC on file the total also
   picks up whatever plan findings apply — the 2026-08-26 run showed $836.00 because a
   `coinsurance_mismatch` of $13.85 fired as well.
   ✓ **False-positive control:** M3 was re-run immediately after and stayed at $175 / $120 /
   $120 / $55 with **no** `cost_share_error` and no plan mismatch. The check fires on a broken
   EOB and stays silent on a consistent one.
   ✓ The found-money card is labelled just "**Worth disputing**" — the old sentence-long label ("money you may not owe; hold off paying this part") is gone from every report.
   ✓ Footer: "**Not checked against your plan** — add your Summary of Benefits under 'Your coverage' on the bills page to enable plan checks."

**Cost:** 1 audit.


**Verified on production 2026-08-25 — figures below PREDATE the cost-share fix.** They read
$804.15 because the planted $18 error was not yet reported as its own finding; the table above
($822.15) is what a run today should produce. Kept as the record of that run, not as the
expectation. From a freshly reset account, every figure matched the answer key of the time —
billed $2,115.00, EOB allowed $841.75, responsibility $186.35, worth
disputing **$804.15**, with `duplicate_charge` $145.50, `billed_vs_allowed_mismatch` $658.65
and `charity_care_eligible` $186.35 at medium confidence. The sanity check holds:
145.50 + 658.65 = 804.15 exactly, charity care excluded. `droppedUnverified` 0,
`ocrConfidence` 100, scan caveat correctly hidden, plan footer present. Step 1 also
confirmed: onboarding first, audit card above the empty state, dashed "No plan on file"
reminder under Your coverage.

## E1b — Intake and account-menu details (no audits)
**Use case:** the small copy and affordance fixes a full audit pass wouldn't catch.
**Getting here:** on E1's report, click **the logo**, then **Audit a new bill**. (**New audit** on the report goes to the same form directly; either route clears E1's files.)

1. On the audit page: ✓ both dropzones read "**Drop one or more files**, or click to choose"; the SBC dropzone reads "Drop it here" — one plan only.
   ✓ **All three step headings — 1, 2 and 3 — are visible on arrival**, but step 2's INPUTS
     are collapsed. Changed 2026-08-27. The form opens at ~1079px against a 1703px original.
     Nothing materialises from nowhere: you can see steps 2 and 3 waiting.
   ✓ Under step 2, "**Add your bill above and this opens up.**" is shown while collapsed and
     disappears once a bill is staged.
   ✓ **No "Bills & coverage", "Your bills" or "Your coverage" headings appear on the audit
     form.** Until 2026-08-28 the whole dashboard was DUPLICATED inside `<section id="upload">`
     — 17 duplicated element ids, so `getElementById` always returned the copy in `#bills` and
     the copy on the form was never populated. It rendered as empty headings and was most of
     why the form measured 1703px. Deleted; the form is now ~803px.
   ✓ Staging a bill **expands step 2 with a short ease-out**, not a jump. To check it is really
     animating, measure `#upload`'s height ~120ms after the drop — it should be BETWEEN the
     collapsed and open heights, not already at the final value.
   ✓ Removing the staged bill **leaves step 2 open**. Collapsing mid-edit pulls content out
     from under the user; only a fresh form resets it.
   ✓ Returning to a fresh form collapses again and the hint returns.
   *(The reveal animates `grid-template-rows: 0fr → 1fr`, which is the only way to transition
   to an unknown height without a hardcoded max-height that clips or lags. It is disabled under
   `prefers-reduced-motion`.)*
2. Drop two bills one at a time. ✓ They accumulate as rows, nothing is replaced, the button becomes "Start 2 audits →", and the summary reads "**2 audits**: 0 bill+EOB pairs, 2 with no EOB" (no saved EOB exists yet on a fresh account).
3. Open **☰**. ✓ Your full email wraps without breaking mid-word; **Sign out**; then **Reset account — erase all my data** below a divider, in red, with a red (not teal) hover.
4. ✓ The "What's an EOB, and where do I find it?" explainer sits with the **insurance-letter step (step 2)**, directly under that dropzone — not stranded after the bill section.
5. **The "Where your documents go" disclosure.** Changed 2026-08-27 from five lines of prose on
   every visit to a one-line summary that expands.
   ✓ The **summary is always visible** and still carries the load-bearing fact — the bill and
     insurance letter go to Google **"including your name and everything else printed on them"**.
     That sentence must never move behind the toggle.
   ✓ It is **open on a first visit** (clear `ucr-seen-doc-disclosure` from localStorage to test)
     and **collapsed on return**, ~45px instead of a paragraph.
   ✓ Expanded, it covers the no-training claim, that "not used for training" is not "not
     stored", deletion, and links to the full privacy policy.
   *Why: a paragraph nobody re-reads is a worse disclosure than a sentence they do. The
   before-anything-is-sent consent gate is the review screen, which is unchanged.*
5. **Clean up before M1**: remove both staged bills with their **✕**. ✓ The rows disappear and the button returns to "Prepare audit →".

**Verified on production 2026-08-25 (steps 1, 3, 4):** step 1 — both bill/EOB dropzones read
"Drop one or more files, or click to choose", the SBC dropzone reads "Drop it here or click to
choose · PDF or photo". Step 3 — the menu shows the full address `fam-test@useclaimright.test`
(`word-break: break-word`, no overflow), then **Sign out** in the normal ink `rgb(15, 47, 61)`,
then **"Reset account — erase all my data"** in red `rgb(178, 59, 59)`. Step 4 — the "What's an
EOB, and where do I find it?" explainer sits inside the step-2 block, under the EOB dropzone and
its checkbox, not stranded after the bill section.

Step 2's exact wording ("2 audits: 0 bill+EOB pairs, 2 with no EOB") is **only reachable on a
fresh account**; once a saved EOB exists the same widget correctly says "with your saved EOB"
instead. That behaviour is covered by R2 step 6, which was verified. Hover colour resolved from the CSSOM on 2026-08-26:
`.menu-item.danger:hover` is `rgb(253, 240, 240)`, a red tint, and at specificity (0,3,0) it
beats the teal `.menu-item:hover { background: var(--accent) }` at (0,2,0). So Reset account
hovers red, not teal, as the plan requires.
**Cost:** 0 audits.


---

# Main case — the SBC journey

## M1 — One-time plan setup
**Use case:** upload the SBC once; the app configures itself.
**Data:** `fake-sbc.pdf` (Acme Silver PPO: deductible $1,500/$3,000, OOP $6,000/$12,000, period 2026-01-01→12-31, mental health 6/yr, rehab 20/yr, planted "$60 copay" rehab row).

1. Click **Add now** on the reminder line. ✓ The onboarding screen returns, and its skip link now reads "**Not now — back to your audits**" (origin-aware). Drag `fake-sbc.pdf` onto the dropzone.
2. Review screen (single document; the tab is labeled "**Plan (SBC)**", not "Bill"). ✓ Member name/ID chipped. Click **Looks right — analyze**.
3. Back on the bills page, under **Your coverage**:
   ✓ The SBC card is replaced by ONE line: `Plan: Acme Silver PPO · 2026-01-01 → 2026-12-31 · View · Replace · Remove`.
   ✓ Coverage usage: two trackers tagged "**from your plan (SBC) — check the codes**" (6/yr mental health, 20/yr rehab).
   ✓ Deductible card: "$0.00 of $1,500.00 · Target from your plan (SBC)."
   ✓ **View** toggles the stored SBC text; opening a tracker's details clears its tag.
   ✓ The review screen in step 2 shows the SBC itself — never a previously uploaded bill. (The tab label used to read "Bill" here, which made it look like an old document was being reused.)

**Cost:** 1 plan upload.

**Verified on production 2026-08-25:** skip link read "Not now — back to your audits"
(origin-aware), the review tab read **"Plan (SBC)"** not "Bill" and showed the SBC itself.
Extracted Acme Silver PPO, 2026-01-01 to 2026-12-31, deductible $1,500/$3,000, OOP
$6,000/$12,000, limits "Outpatient mental health services 6/yr" and "Rehabilitation services
20/yr", with both trackers auto-created and tagged `source: sbc`.



## M2 — Audit with a planted plan violation
**Use case:** the audit quotes the SBC against the bill and highlights the dollar gap.
**Data:** `series/p1-bill.pdf` + `series/p1-eob.pdf` (PT 97110, 2026-03-20; EOB member responsibility $95 vs SBC's "$60 copay, deductible does not apply").

1. Upload both, Prepare, review, analyze.
   ✓ **The four totals cards**:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$210.00** | the bill's line items |
   | EOB allowed | **$95.00** | what the plan allowed |
   | Your responsibility | **$95.00** | what the EOB says you owe |
   | Worth disputing | **$150.00** | $115.00 billed-above-allowed + $35.00 copay mismatch — and nothing else |

   ✓ "**Copay doesn't match your plan**" ($35.00, medium confidence): mono `SBC` quote of the rehab row, mono `BILL` quote, sentence ending in yellow-highlighted "**$35.00 you may not owe**".
   ✓ "**Billed above EOB allowed**" ($115, high confidence — bill demands $210, EOB says $95).
   ✓ Tracker line "Rehabilitation…: visit 1 of 20". ✓ NO "not checked" footer.
   ✓ Dispute email includes `My plan (SBC) states: "…$60 copay…"`.

**Cost:** 1 audit.

**Verified on production 2026-08-25:** billed $210.00, EOB allowed $95.00, responsibility
$95.00, worth disputing **$150.00** — `billed_vs_allowed_mismatch` $115.00 high plus
`copay_mismatch` $35.00 medium, and nothing else. `planApplied: true`, `planReason: null`,
`droppedUnverified` 0, and the copay finding carried a verbatim SBC quote beginning
"Rehabilitation services (physical, occupational therapy) $60". The arithmetic holds exactly:
115 + 35 = 150.


## M3 — Consistent claim: no false positives + combined deductible sourcing
**Use case:** plan terms that agree with the EOB stay silent; deductible card merges SBC target with EOB progress.
**Data:** `series/t1-bill.pdf` + `series/t1-eob.pdf` (90837, $175 billed, $120 to deductible — consistent with the SBC's "$0 coinsurance after deductible" row).

1. Upload both, Prepare, review, analyze.
   ✓ **The four totals cards** — this is the "t-series shape" other plans refer back to:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$175.00** | the bill's line items |
   | EOB allowed | **$120.00** | what the plan allowed |
   | Your responsibility | **$120.00** | applied to the deductible, per the SBC |
   | Worth disputing | **$55.00** | billed-above-allowed only ($175 − $120); no plan-mismatch finding |

   ✓ NO plan-mismatch findings. (One "Billed above EOB allowed" $55 finding is expected — the fixture bill demands the full $175.)
   ✓ Mental-health tracker: "visit 1 of 6".
   ✓ Deductible card: "**$120.00 of $1,500.00** — Target from your plan (SBC). As stated on your most recent EOB (2026-01-15)."

**Cost:** 1 audit.

**Verified on production 2026-08-25:** billed $175.00, EOB allowed and responsibility
$120.00, worth disputing **$55.00** from a single `billed_vs_allowed_mismatch`, and
**zero plan-mismatch findings**. `planApplied: true`, so the plan was checked and chose to
stay silent rather than being skipped — which is the whole point of this plan and the harder
direction to get right. Accumulators picked up `deductibleToDate` 120 against
`deductibleLimit` 1500. The documented regression (a false `deductible_misapplied` at $95)
did not fire. `droppedUnverified` 0.


---
## M4 — Batch with a consolidated EOB, plan still applied
**Use case:** many bills + one EOB in a single review-all pass; plan checks apply to every audit in the batch.
**Data:** `series/t2-bill.pdf`, `series/t3-bill.pdf`, `series/t-eob.pdf` (consolidated statement covering t1–t3; leave "save this EOB" checked).

1. Add all three files — **bills first** (see the session-setup note: the EOB dropzone only
   appears once a bill is staged). Beyond that, any zone: filenames route them. ✓ Rows
   accumulate; summary "2 audits: 2 bill+EOB pairs"; button "Start 2 audits →".
2. Start. ✓ Per-document extraction progress, then ONE review screen with 3 tabs + "Reviewing <name> — document N of 3".
3. Confirm once. ✓ "Analyzing audit 1 of 2… 2 of 2" with no pauses, then the batch **lands on the Bills & coverage page — not on one audit's report**. (Before this change it showed whichever audit the queue ordered last, with no signal the other existed.)
   ✓ A **highlighter-ribboned "JUST AUDITED" block** sits above "Your bills": "JUST AUDITED · **2 bills** · **$110.00** worth disputing", then one row per audit — date · plain-English finding · amount. Each t-audit is $55 (bill demands $175, EOB responsibility $120), so the block's total is the real batch total; no screen shows $55 as if it were the answer for the whole batch.
   ✓ Clicking either row opens **that** audit's own report, and **the logo** returns with the block still pinned. Both reports carry the t-series shape:

   | Card | Expected (each audit) | Why |
   |---|---|---|
   | Billed | **$175.00** | that bill's line items |
   | EOB allowed | **$120.00** | that bill's claim line in the consolidated EOB |
   | Your responsibility | **$120.00** | applied to the deductible, per the SBC |
   | Worth disputing | **$55.00** | billed-above-allowed only — **$110.00 across the batch**, which is what the JUST AUDITED block states |

   ✓ The same two bills **also appear below in their provider group** — the block is a lens on the list, not a second list, so nothing is hidden from the permanent view.
   ✓ The block is session-scoped: it survives navigating to a report and back, and disappears once a new audit run starts or the page is reloaded.
   ✓ Each audit matches its claim line in the consolidated EOB (no false `not_in_eob` for t2/t3); mental-health tracker reaches 3/6; deductible $360.
   ✓ **No `deductible_misapplied`** on either audit. The SBC's mental-health row reads "$0 coinsurance **after** deductible", so applying $120 to the deductible is correct. *(Regression guard: this fired falsely once at $95 — the model had matched psychotherapy to the generic "specialist visit — deductible does not apply" row.)*
   ✓ Each audit's `serviceDates` holds **only its own bill's date** — not all three dates from the consolidated EOB. *(Regression guard: t3's audit once recorded 2026-01-15, 02-12 and 03-11.)*

**Verified on production 2026-08-25:** ran clean. JUST AUDITED read "2 bills · $110.00 worth
disputing" with $55.00 on each row; both audits carried `planApplied: true`; no
`deductible_misapplied` on either. Both regression guards held — each audit's `serviceDates`
held only its own bill's date (`["2026-03-11"]` and `["2026-02-12"]`), not all three from the
consolidated EOB.


**Cost:** 2 audits.

## M5 — EOB library reuse + missing-claim detection
**Use case:** the saved consolidated EOB pre-selects for the next bill; a claim it doesn't cover is flagged.
**Data:** `series/t4-bill.pdf` alone (April visit — not in the consolidated EOB).

1. Expand "My saved EOBs". ✓ The consolidated EOB saved ONCE despite 2 audits sharing it.
2. Upload `t4-bill.pdf` only.
   ✓ **With more than one saved EOB, nothing is pre-selected** and the label reads "Choose which
   saved EOB covers this bill — the wrong one makes an audit look clean when it isn't". Pick
   **the consolidated Testville EOB** explicitly. *(Changed 2026-08-28. This step used to read
   "✓ Saved EOB pre-selected"; auto-picking the most recent is exactly what attached an ER EOB
   to a psychotherapy bill and produced "no discrepancies found" on $175. A single saved EOB is
   still pre-selected, so the zero-click case survives.)*
3. Prepare, review, analyze.
   ✓ On the review screen the label reads "Using saved EOB: …". *(The "matched by provider and
   service date" explanation is gone: it was produced by a content matcher that read the bill's
   text layer, and the browser no longer has one — every PDF is sent as pages.)*
   ✓ "**On the bill, missing from the EOB**" (`not_in_eob`) — mental-health tracker 4/6.
   ✓ **The four totals cards** (re-verified 2026-08-11):

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$175.00** | the bill's line items |
   | EOB allowed | **$0.00** | the EOB never adjudicated this April visit |
   | Your responsibility | **$175.00** | with nothing allowed, the whole bill lands on you |
   | Worth disputing | **$175.00** | the entire bill — one `not_in_eob` finding |

   ⚠️ *Allowed $0 with the full bill at stake* is also exactly what a **mismatched pair** looks like (E6). Here it's genuine; there it isn't. The totals alone cannot tell them apart — that's why E6's warning banner exists.
   ✓ **No** "every line came back missing" warning here, by design: that backstop needs **2+** findings all of type `not_in_eob`, so a single genuinely-unadjudicated claim never trips it.

**Cost:** 1 audit.

**Verified on production 2026-08-25:** the consolidated EOB appeared ONCE in the library
despite two audits sharing it. `t4-bill.pdf` alone pre-selected it ("using saved: TESTVILLE
BEHAVIORAL HEALTH ASSOCIATES · 2026-02-12 — change below if this isn't the right one") and
the review screen explained the pick — "matched by provider". Totals $175.00 / $0.00 /
$175.00 / **$175.00** from a single `not_in_eob`, and the "every line came back missing"
backstop correctly did NOT fire on one finding. `droppedUnverified` 0.

**Re-verified on production 2026-08-28**, from a reset account with E1→M1→M2→M3→M4 run in order
so the consolidated EOB was genuinely in the library:

| Card | Expected | Got |
|---|---|---|
| Billed | $175.00 | **$175.00** |
| EOB allowed | $0.00 | **$0.00** |
| Your responsibility | $175.00 | **$175.00** |
| Worth disputing | $175.00 | **$175.00** |

`not_in_eob` $175.00 high confidence, mental-health tracker **visit 4 of 6**,
`droppedUnverified` 0. Nothing was pre-selected (4 saved EOBs on file); the consolidated EOB
was chosen explicitly.

**The discrimination, confirmed in both directions on the same day:**

| Pair | `documentsRelated` | Warning |
|---|---|---|
| M5 — t4-bill + consolidated Testville EOB | `related: true, confident: true, sharedCodes: ["90837"]` | correctly **hidden** |
| E6 — t5-bill + St. Verification ER EOB | `related: false, confident: true, sharedCodes: []` | correctly **shown** |

A genuine missing claim and a mismatched pair look identical on the totals cards — $175.00
billed against $0.00 allowed in both — so this comparison is the only thing separating them.

## M6 — Plan lifecycle: duplicate re-upload
**Use case:** re-uploading the same SBC never re-extracts or duplicates.
**Data:** the same `fake-sbc.pdf`, via the plan line's **Replace**.

1. Replace → pick `fake-sbc.pdf` → confirm the review.
   ✓ "**This plan is already on file.**" — immediate, no "Reading your plan's terms…" step, no plan-upload consumed; plan line unchanged.

**Cost:** 0.

**Verified on production 2026-08-25:** "This plan is already on file." appeared immediately,
with no "Reading your plan's terms…" step, no plan upload consumed (`planCount` stayed at 1
from M1) and no confirmation dialog — the duplicate check is client-side, before the callable.

## M7 — Zero-entry tracking from remarks (optional, +3 audits)
**Use case:** when an EOB remark prints the limit, one click tracks it — no typing. (With an SBC on file the trackers already exist; to see this path, delete the mental-health tracker first or run without a plan.)
**Data:** `series/t4-bill.pdf`+`t4-eob.pdf`, `t5-bill.pdf`+`t5-eob.pdf`, `t6-bill.pdf`+`t6-eob.pdf`.

✓ **The four totals cards** — each of the three pairs carries the t-series shape:

| Card | Expected (each pair) | Why |
|---|---|---|
| Billed | **$175.00** | the bill's line items |
| EOB allowed | **$120.00** | what the plan allowed |
| Your responsibility | **$120.00** | applied to the deductible |
| Worth disputing | **$55.00** | billed-above-allowed only |

*This plan is about the tracker, not the cards — but if a pair's cards drift from the shape above, that's a finding worth chasing before trusting the tracker numbers.*

**Cheaper route (1 audit):** with an SBC on file, delete the mental-health tracker first, then audit the **t5 pair only** — the remark path fires on that single audit.

1. Audit the pairs in order. After t5 (remark "5 of 6 covered outpatient mental health visits used"), if its codes are untracked:
   ✓ The 💡 banner offers "Track it" — ONE click creates the tracker fully configured (codes, limit 6, plan year, `source:"remark"`) with no form. The manual form is labeled "**Add a custom limit**" and remains the fallback for unprinted limits.
   *(Regression guard, fixed 2026-08-16: the remark matcher required "visits" to follow "N of M covered" immediately, so the real remark — which names the benefit in between — never matched and this banner never appeared. `web/js/usage.js` now allows up to 5 words there.)*
2. After t6: ✓ tracker red ("Limit reached…"), deductible card $720 of $1,500.

**Verified on production 2026-08-25 (cheaper route, 1 audit):** deleted the SBC mental-health
tracker, then audited the t5 pair alone. The four cards held the t-series shape exactly —
$175.00 / $120.00 / $120.00 / $55.00. The banner fired with the real remark, which is the
regression the 5-word allowance exists for:

> 💡 Your insurer mentioned a benefit limit for 90837 — Psychotherapy, 60 minutes
> ("5 of 6 covered outpatient mental health visits used this plan year."). **Track it**

ONE click created the tracker with **no form and no dialog** — Firestore shows
`label: "Psychotherapy, 60 minutes"`, `limit: 6`, `codes: ["90837"]`, `source: "remark"`. It
rendered immediately as "8 / 6 · Over the limit" against 8 contributing audits, and — unlike
the SBC-sourced tracker beside it — carries no "from your plan (SBC) — check the codes" caveat,
because the codes came from the remark itself. The manual fallback is labelled "Add a custom
limit". Note `planYearStart`/`planYearEnd` are `null` on **both** trackers: the plan year shown
("2026-01-01 → 2026-12-31") is rendered from the SBC, not stored per tracker. Pre-existing
behaviour, not the remark path.

**Cost:** 3 audits.

## D1 — Bills & coverage dashboard, incl. cross-bill duplicate
**Use case:** the cumulative view — what's worth disputing across all bills, what coverage is left, and the one finding no single audit can produce (the same visit billed on two statements).
**Data:** `series/t2-bill.pdf` + `t2-eob.pdf`, then `series/t2-bill-rebill.pdf` + `t2-eob.pdf` (a second statement for the same 2026-02-12 visit — same provider, same 90837, different statement date and account number), with `fake-sbc.pdf` on file.

1. Audit the t2 pair, then audit the re-bill pair. Each single audit ends on its own report — click **the logo** to reach the dashboard. (The dashboard is also where you land on every sign-in: it is the home screen, and the audit form is reached from its "Audit a new bill" card.)
   ✓ **The four totals cards** — both reports carry the t-series shape (verified 2026-08-10):

   | Card | Expected (each audit) | Why |
   |---|---|---|
   | Billed | **$175.00** | that statement's line items |
   | EOB allowed | **$120.00** | what the plan allowed for the Feb 12 visit |
   | Your responsibility | **$120.00** | applied to the deductible |
   | Worth disputing | **$55.00** | billed-above-allowed only — the **duplicate is not in either report**, because no single audit can see it |

   *That last row is the point of this plan: the $175 duplicate appears only on the dashboard, never in an individual report.*
2. ✓ **Hero card** at the top of "Bills & coverage": a yellow ribbon "FOUND BY COMPARING YOUR BILLS TO EACH OTHER", **$175.00 at stake**, "The same visit is on two statements", naming the provider, 90837, and Feb 12 2026, with **Statement A / Statement B** each showing its audited date and amount (never a statement number), plus a "Why this was flagged" explainer. Clicking a statement opens that audit.
3. ✓ **Your bills**: one group per provider — the same provider under different extraction casing must be **one** group — sorted by amount at stake, header pill "$110.00 worth disputing across 1 provider", each row showing date · plain-English finding summary · amount · ✕.
4. ✓ **Your coverage**: Deductible "$240.00 of $1,500.00" sourced "**Target from your plan (SBC).** As stated on your most recent EOB (2026-02-12)." with "$1,260.00 to go"; **Out-of-pocket maximum** card present ("$0.00 of $6,000.00 · 0%"); tracker cards below.
5. ✓ Negative control: the t-series alone (same code, *different* dates) must produce **no** duplicate hero. Auditing the same bill twice must also produce none.

**Cost:** 2 audits (+1 plan upload if no SBC on file).

**Verified on production 2026-08-25.** Each report carried the t-series shape ($175.00 /
$120.00 / $120.00 / **$55.00**, one `billed_vs_allowed_mismatch`), and the $175.00 duplicate
appeared ONLY on the dashboard — "FOUND BY COMPARING YOUR BILLS TO EACH OTHER", "The same
visit is on two statements", naming 90837 and Feb 12 2026, with Statement A / Statement B
showing audited dates and amounts and no statement numbers. Provider grouping held: three
audits under differing extraction casing collapsed into ONE "Testville Behavioral Health
Associates" group.

**This plan caught a regression.** On the first run no hero appeared. The model had extracted
`patientName` from one statement of the pair and not the other, and the duplicate key
included it — so "" and "jane testpatient" read as different people and a genuine double-bill
went unreported. Identity now separates people only when EVERY bill in the group names one.
Regression covered in `functions/test/family.test.js`.

**Step 5's negative control — "auditing the same bill twice must produce none" — is the
`billKey` case, and it was NOT covered by the run above.** It was verified separately on
2026-08-26 in a stronger form: the same bill audited as a PDF and again as a photo, which is
the version that used to fail. See the billKey section near the top of this file. Re-run that
rather than auditing one PDF twice, because two identical extractions hash identically and pass
even when the identity logic is broken.

⚠️ **Note when re-running:** hosting serves JS with `max-age=300`, so a freshly deployed
module can take up to five minutes to reach an open tab. A page that still shows the old
behaviour after a deploy is very likely cached — prime it with
`fetch(url, { cache: "reload" })` before concluding the fix did not work.

---

# Remaining exceptions

## E2 — No EOB (bill-only) with SBC on file
**Use case:** bill-only audits still get plan checks; the no-EOB note explains the hierarchy.
**Data:** `series/t5-bill.pdf`, checkbox "I don't have an EOB".

1. Upload the bill, tick the checkbox. ✓ Note appears: bill-only checks + "if your Summary of Benefits is on file (top of this page)… the audit gets stronger when the EOB arrives."
2. Prepare, review (Bill tab only), analyze.
   ✓ Audit completes; NO EOB-comparison finding types (billed_vs_allowed / not_in_eob / cost_share_error).
   ✓ **The four totals cards**:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$175.00** | the bill's line items — the only figure a bill alone can support |
   | EOB allowed | **$0.00** | forced to zero by design with no EOB; the app never implies it knows what the plan allowed |
   | Your responsibility | **$0.00** | likewise forced to zero — no EOB means no statement of what you owe |
   | Worth disputing | **$0.00** | bill-only findings (duplicates/coding) only; $0.00 when the bill is clean, as t5 is |
   ✓ Plan checks may still fire from the bill alone (medium/low confidence at most); no "not checked" footer (service date 2026-05-13 is in-period).

**Verified on production 2026-08-25:** billed $175.00, `eobAllowed` $0.00, `patientResponsibility`
$0.00, `worthDisputing` $0.00, zero findings, no EOB stored against the audit, and
`planApplied: true` — the plan checks ran from the bill alone, as designed.

**Cost:** 1 audit.

## E3 — Remove the plan
**Use case:** deleting the plan reverts the app to the no-SBC state without touching trackers or history.
**Data:** none.

1. Click **Remove** on the plan line. ✓ Confirm dialog names the plan, **counts the limits that
   go with it** ("5 limits this plan set up will go with it"), and says limits you added
   yourself or accepted from an EOB stay.
2. Confirm. ✓ The dashed "No plan on file — add your Summary of Benefits · Add now" reminder
   returns under **Your coverage**.
   ✓ **Changed 2026-08-28: trackers the SBC created are removed with it.** They used to
   survive, still labelled "from your plan (SBC)" with no SBC on file — limits the member never asked
   for, kept by a dialog that promised only "trackers you've created stay". Manual and remark
   trackers still stay; re-uploading an SBC recreates its limits, and counts derive from audits,
   so nothing is lost.
   ✓ With no EOB stating its own figures, the deductible and out-of-pocket cards disappear
   entirely. Where an EOB DOES state them, they fall back to EOB-stated values ("$120.00 of $1,500.00" from t-series EOBs, no "Target from your plan" line... EOB-only sourcing).

**Verified on production 2026-08-25:** the dialog read "Remove your plan?" / "Acme Silver PPO
will be removed, and audits will no longer be checked against it. Trackers you've created
stay." / "Remove plan" in red, and the renderer stayed responsive. After confirming, the dashed
"No plan on file — add your Summary of Benefits · Add now" reminder returned, the deductible
card dropped its "Target from your plan (SBC)." line and fell back to EOB-only sourcing
("$240.00 of $1,500.00 · As stated on your most recent EOB (2026-04-15)"), and **both trackers
survived intact** — "Outpatient mental health services 7 / 6" (over limit) and "Rehabilitation
services 1 / 20", each keeping its contributing-audit count. Exactly what the dialog promised.

**Cost:** 0.

## E4 — Wrong document on the SBC dropzone
**Use case:** a non-SBC upload is rejected cleanly, storing nothing.
**Data:** `series/t6-bill.pdf` uploaded as an SBC.

1. Upload it to the SBC dropzone, confirm the review.
   ✓ Error: "**This doesn't look like a Summary of Benefits.**" — no plan stored, the empty-state card remains.
   (Note: this consumes a plan upload — the guard runs before extraction.)

**Verified on production 2026-08-26 — its first run ever.** `series/t6-bill.pdf` uploaded to
the SBC dropzone was rejected with exactly "This doesn't look like a Summary of Benefits." A
stronger result than the plan asks for: a plan (Acme Silver PPO) WAS on file at the time and
survived untouched, so the guard rejects without clobbering good data, not merely without
storing bad data.

**Cost:** 1 plan upload.

## E5 — Restore the plan (closes the loop)
0. ✓ **Replace** on the plan line opens the same onboarding screen as **Add now** — "Set up
   your plan", with a real dropzone and the origin-aware "Not now — back to your audits". It
   used to be a `<label>` wrapping a hidden file input, so it could only open the OS file
   dialog: no drag-and-drop, and the smallest target on the card.
1. Upload `fake-sbc.pdf` again via **Add now** under "Your coverage". ✓ Full M1 checkpoints repeat (plan line, trackers update in place — no duplicates, `source:"sbc"` trackers refreshed).

**Verified on production 2026-08-25:** re-uploading `fake-sbc.pdf` through **Add now** restored
"✓ Plan on file: Acme Silver PPO · 2026-01-01 → 2026-12-31". The origin-aware skip link read
"Not now — back to your audits". Trackers updated **in place**: still exactly two, same counts
(7/6 and 1/20), no duplicates. "Target from your plan (SBC)." returned to the deductible card and
the out-of-pocket-maximum card came back with it.

**Cost:** 1 plan upload (3/3 for the day after M1 + E4 + E5).

## E6 — Wrong EOB paired with a bill

**De-overlap (fixed 2026-08-25).** This plan is also the reproduction for overlapping findings,
because a mismatched pair makes every finding type fire at once. The first run reported
**$2,115.00 billed and $2,260.50 worth disputing** — a headline larger than the bill, which is
the figure a member acts on when deciding what to withhold.

The arithmetic was exact: `not_in_eob` over `"Line 1 - Line 6"` ($2,115.00, the whole bill) plus
`duplicate_charge` over `"Line 2"` ($145.50, one line inside it). `charity_care_eligible` was
already excluded as advisory. The $145.50 is not extra money; it is a reason inside the larger
claim.

`computeAtStake` now parses `lineRef` and drops any finding whose lines are **strictly
contained** in another's, then caps the total at `billed`. Both rules round the same way,
toward understating: overstating is the failure that costs the product its credibility. Only
strict containment is deducted — partial overlaps are ambiguous and stay summed, with the cap as
the backstop. An unparseable `lineRef` (`"Header"`, a nonsensical `"Line 1 - 99999"` span)
yields an empty set and is never de-overlapped, so it can only ever cost a deduction we were
unsure of.

Re-verified live on the same pair: **worth disputing $2,115.00**, equal to billed. Containment
did the work, not the cap — the model wrote `"Lines 1-6"` on the re-run, a different shape from
the original `"Line 1 - Line 6"`, and both parse. **Both findings are still shown on the
report**; de-overlap changes the total, never what is surfaced.
**Use case:** pairing the wrong EOB must be called out, not silently reported as "you may not owe the whole bill".
**Data:** copies of two unrelated fixtures given matching stems so they pair by filename — e.g. `mixup-bill.pdf` (copy of `fake-bill.pdf`, ED visit 2026-06-12) + `mixup-eob.pdf` (copy of `series/p1-eob.pdf`, PT 2026-03-20).

1. Upload both, Prepare audit. ✓ They pair ("1 audit: 1 bill+EOB pair").
2. On the review screen, **before** analyzing:
   ✓ Banner: "⚠️ **This EOB may not cover this bill** (mixup-bill.pdf) — they share no service dates and no procedure codes…"
3. Repeat with a genuine pair (`p1-bill.pdf` + `p1-eob.pdf`). ✓ **No banner** — a real pair shares dates and codes.
4. ~~Note: files with clearly different stems never pair at all.~~ **Changed 2026-08-25.**
   Exactly one bill and exactly one EOB now pair regardless of filename — the user put them in
   two labelled dropzones, and a household EOB never shares a stem with one bill. So
   `fake-bill.pdf` + `p1-eob.pdf` DO pair, and this plan can be run with them directly instead
   of making `mixup-*` copies. Ambiguity is still preserved: two bills and one unmatched EOB
   leaves the EOB orphaned (see FAM3).
5. Backstop (needs a real audit): if a mismatched pair is analyzed anyway and **every** finding comes back `not_in_eob`, the report shows "⚠️ Every line on this bill came back missing from the EOB…" above the totals.
   ✓ **Fixed 2026-08-16.** It originally failed here: the model returned `duplicate_charge` and `charity_care_eligible` alongside `not_in_eob`, and the old condition demanded *every* finding be `not_in_eob`. The report now also fires when the two documents share **no dates and no codes** — the same `documentsRelated()` evidence the step-2 banner uses — and the wording adapts: "**This EOB may not cover this bill.** They share no service dates and no procedure codes…".
   ✓ The discrimination that matters: this audit shows the warning, while **M5's genuine missing claim does not** (its bill and EOB do share a code). Verified live on both.

**Step 5 verified on production 2026-08-29** with `by-plan/E6-wrong-eob-paired/` (ED-visit bill,
PT EOB, matching stems so they pair by filename): billed **$2,115.00**, EOB allowed **$0.00**,
responsibility **$845.00**, worth disputing **$2,115.00** — the documented mismatched-pair
signature — and the warning rendered **on the post-run report**, which is the path this plan
warns you to assert on.

**Verified on production 2026-08-25 (steps 1-2):** `fake-bill.pdf` (ED visit, 2026-06-12) and
`p1-eob.pdf` (PT, 2026-03-20) paired under the new rule and the guard fired immediately —
"⚠️ This EOB may not cover this bill (fake-bill.pdf) — they share no service dates and no
procedure codes." The two changes compose the way they should: pairing is permissive about
filenames, the guard is strict about content. Backed out with Start over, so no audit spent.
Step 5's backstop was re-run later the same day — see the step-5 block above, where it
failed first and was fixed.
   ✓ **The four totals cards** — the failure signature the banner exists for:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | the ED bill's total (**~$2,115.00**) | the bill's line items |
   | EOB allowed | **$0.00** | the PT EOB adjudicated nothing on this bill |
   | Your responsibility | ≈ the **entire bill** | nothing allowed, so everything lands on you |
   | Worth disputing | ≈ the **entire bill** | every finding is `not_in_eob` |

   ⚠️ These are the same numbers as **M5**, where the missing claim was genuine. The totals cannot distinguish "your insurer never processed this" from "you paired the wrong two documents" — the banner in step 2 is the only thing that can, which is why it must fire *before* the audit is spent.

**Verified on production 2026-08-25 (step 5) — and it FAILED first.** Running
`fake-bill.pdf` (ED, 2026-06-12) + `p1-eob.pdf` (PT, 2026-03-20) produced findings
`duplicate_charge` + `not_in_eob` + `charity_care_eligible` — the exact mix the 2026-08-16 fix
was written for — and **no warning appeared on the report**. Re-opening the same audit from the
bills list showed it correctly, which localised the bug to the render path rather than the
logic.

Cause: `renderReport` after a run was called with `unrelatedPair(payload.bill, payload.eob)`,
but `payload.bill` is the wire-format doc `{text, images}`, not a string. `String(doc)` is
`"[object Object]"` — no dates, no codes — so `documentsRelated` returned "cannot judge" and
the warning was **silently suppressed on the one report that matters most: the one you see
immediately after paying for the audit.** `openAudit` was unaffected because it passes
`auditText(data, ...)`, which is a real string. Same root cause as the f9b4498 mixed-document
bug: the wire format became doc objects and a call site kept treating it as text.

Fixed by passing `payload.bill.text` / `payload.eob.text`. Re-verified with a *different*
mismatched pair (`p1-bill.pdf`, PT 2026-03-20 + `t5-eob.pdf`, psychotherapy 2026-05-13): the
review banner fired before analysis, and the post-run report showed the warning **above the
totals**, which read $210.00 / $0.00 / $210.00 / $210.00 — the documented failure signature.

### The second failure, 2026-08-28: no findings, no warning

Reported from a live M5 run: a psychotherapy bill audited against an unrelated ER EOB reported
**$175.00 billed / $0.00 allowed / $0.00 worth disputing** and *"No discrepancies found"*, with
no mismatch warning anywhere.

Two independent causes, both introduced when PDFs began being sent as page images:

1. **The pre-send guard read text the browser no longer had.** Pages replaced the text layer, so
   `documentsRelated("", "")` returned "cannot judge" on every PDF and the banner could never
   fire. A guard that is structurally incapable of firing is worse than no guard: it reads as
   coverage. Removed, and the report-side guard now runs on the model's own transcription
   (`auditText`), which is the only text that still exists.
2. **The report-side guard was gated on findings existing** — `anyMissing && (…)`. With the
   wrong EOB the model found *nothing*, so `anyMissing` was false and the warning stayed hidden.
   The quietest possible way to be wrong: a confident "no discrepancies found" against a
   document that was never about this bill. Now `pairUnrelated` shows the warning on its own,
   and when there are no findings the copy says so explicitly — *"a finding of 'nothing wrong'
   carries no weight against the wrong EOB."*

Third change, upstream of both: **a saved EOB is only pre-selected when the library holds exactly
one.** "Most recent" was a guess, and with no bill text there is nothing left to check it
against before an audit is spent. That guess is what attached the ER EOB in the first place.

A fourth cause surfaced only by testing it: **the callable never returned the transcription.**
`analyze` wrote `bill`/`eob` to Firestore but returned `{auditId, planApplied, planReason,
...result}` — and `result` has findings and totals, no text. So the post-run report called
`unrelatedPair("", "")` and the warning stayed hidden, while the *re-opened* report (which reads
the Firestore doc) showed it correctly. That is the identical shape as the `[object Object]`
bug above: the post-run and re-opened reports disagree because they get their text from
different places. `analyze` now returns `bill: billStore, eob: eobStore`.

The same missing text was corrupting the EOB library: `maybeSaveEob(state.eob.text, …)` filed
`""` for every PDF EOB, under a real-looking label — and because `savedEobText(e) === ""` matches
any empty entry, the dedup check would then treat every later EOB as already saved. Now saves
`data.eob`, and refuses to file an empty string at all.

**Regression assertion for this plan:** a mismatched pair that yields *zero* findings must still
show the warning. Testing only the "every line missing" shape is what let this through.

### Verified on production 2026-08-28

`t5-bill.pdf` (psychotherapy, 90837, 2026-05-13, $175.00) against the saved ER EOB
(St. Verification General Hospital, 2026-06-12, codes 80053/85025/99284/71046/J1200):

| Check | Result |
|---|---|
| saved EOB pre-selected with 2 in the library | **no** — dropdown reads "— choose a saved EOB —" |
| label copy | follows the behaviour: "Choose which saved EOB covers this bill…" |
| `documentsRelated` on the pair | `{related: false, confident: true}` — no shared dates, no shared codes |
| **post-run** report | ⚠️ warning rendered **above the totals** |
| **re-opened** report | ⚠️ same warning |
| the finding | $175.00 `not_in_eob`, high confidence — **worth disputing $175.00** |
| screen trace | `bills → upload → processing → review → processing → report`, no stray routing |

The $175 answers the original report: the bill *should* be disputed, and the earlier
"no discrepancies found" was the wrong EOB talking.

WARNING — **when re-running this plan, assert on the report you get straight after the run, not
on a re-opened one.** The two go through different code paths, and only the re-opened one was
ever checked before, which is why this survived since the wire format changed.

**Cost:** 0 audits for steps 1–4 (back out with **Start over**); 1 audit for step 5.

## X1 — Destructive confirmations
**Use case:** six actions delete something. Until 2026-08-25 all six asked through the
browser's native `confirm()`, which is unstyled, says one line, offers "OK" as the verb for
everything, and freezes the renderer — so this entire half of the app was untestable.
**Data:** any account with an audit, a saved EOB, a plan and a tracker on it.

For each of: **delete an audit · delete a saved EOB · remove the plan · stop tracking a
limit · replace a plan with an older one · erase all data**

1. ✓ A branded dialog appears, not an OS confirm, and **the page stays responsive**.
2. ✓ The title asks the actual question ("Delete this audit?", "Remove your plan?").
3. ✓ The body says what happens AND what survives — "Your other audits are untouched",
   "Trackers you've created stay".
4. ✓ The button carries the verb ("Delete audit", "Remove plan"), never "OK".
5. ✓ Destructive ones render the primary button **red**; "replace an older plan" does not,
   because it is not destructive.
6. ✓ **Cancel, Esc and clicking the backdrop all decline.** Dismissal is never consent.

**Verified on production 2026-08-25:** four of the six paths, plus all three dismissal routes.

| Path | Title | Body names what survives | Verb | Red |
|---|---|---|---|---|
| delete an audit | "Delete this audit?" | "Your other audits are untouched." | "Delete audit" | ✓ |
| remove the plan | "Remove your plan?" | "Trackers you've created stay." | "Remove plan" | ✓ |
| stop tracking a limit | "Stop tracking this limit?" | "Audits already run are unaffected." | "Stop tracking" | ✓ |
| delete a saved EOB | "Delete this saved EOB?" | names the EOB and what it stops doing | "Delete" | ✓ |
| replace with an older plan | "Replace the plan on file with an older one?" | quotes **both** coverage periods and what changes | "Replace anyway" | ✗ (teal) |

Red is `rgb(178, 59, 59)` on the four destructive ones. The replace-with-an-older-plan dialog is
the discriminating case and it behaves: `rgb(13, 138, 138)` teal with no `danger` class, because
replacing a plan destroys nothing. Cancelling left the 2026 plan on file. It needed a fixture
that did not exist, so `test-fixtures/fake-sbc-older.html` was added — `fake-sbc.html` with the
coverage period shifted to 2025. The SBC input accepts `text/html`, so no PDF render is needed. The renderer stayed responsive throughout — every one of
these was clicked, read and dismissed from script, which the old native `confirm()` made
impossible. All six paths are now covered: "erase all data" was verified when E7 ran on 2026-08-25
("Erase everything?" / red / body naming what survives).

⚠️ **Found and fixed here 2026-08-25 — backdrop click did nothing.** Step 6 claims Cancel, Esc
and the backdrop all decline. Cancel and Esc did (`dlg.onclose` resolves `false`), but a native
`<dialog>` does **not** close on a backdrop click without an explicit handler, and there was
none — the click was swallowed and the dialog just sat there, which reads as a frozen page.
The safety property still held (dismissal never became consent: the tracker survived), so this
was a stuck affordance, not a data risk. Fixed in `web/js/app.js` `confirmAction()` with
`dlg.onclick = (e) => { if (e.target === dlg) done(false); }` — the dialog carries `padding:0`,
so `e.target === dlg` is true only for a true backdrop click and never for a click on its
contents. Re-verified after deploy: backdrop click closes the dialog **and** the tracker
survives. Note that a synthetic `KeyboardEvent("Escape")` will NOT close a dialog — Esc must be
tested with a real key press, or you will record a false failure.

**Cost:** 0 audits (deletes only).

## E7 — Reset account returns you to onboarding (destructive — snapshot first)

**Verified on production 2026-08-25 — all three steps, and reversibly.** The confirmation is the
app's own dialog: "Erase everything?" / "This deletes every audit, saved EOB, tracker and your
plan. It cannot be undone. Today's usage counters stay as they are." / red `rgb(178, 59, 59)`
"Erase everything" — X1's sixth and last path.

From a baseline of 13 audits, 2 trackers, 6 saved EOBs, a plan on file and "7 of 10 audits left
today":
- Step 1: landed on **"Set up your plan"**, not the audit page, and the skip link read the
  **first-visit** wording "Skip for now — audit a bill first" — against the origin-aware
  "Not now — back to your audits" the same screen shows when reached via **Add now** (E5). The
  `ucr-skip-onboarding` localStorage key was cleared along with the Firestore data.
- Step 3: `meta/usage` **survived untouched** — `count: 3`, `planCount: 2`, unchanged. Reset is
  not a way to buy more audits.
- Firestore confirmed empty: 0 audits, 0 trackers, 0 eobs, `plan/active` gone.

**How to run this without losing the account.** E7 no longer has to be run last or on a scratch
account. Use `scripts/account-snapshot.py`:

```
python3 scripts/account-snapshot.py save    <uid>            # snapshot
python3 scripts/account-snapshot.py restore throwaway-uid    # prove the write path
python3 scripts/account-snapshot.py verify  throwaway-uid    # must print EXACT
#   ... now run E7 in the browser and assert on it ...
python3 scripts/account-snapshot.py restore <uid>
python3 scripts/account-snapshot.py verify  <uid>            # must print EXACT
```

It captures `audits`, `trackers`, `eobs` (NOT "savedEobs" — the wrong name returns an empty list
rather than an error, which is how the first snapshot silently missed the whole EOB library)
plus the singletons `plan/active` and `meta/usage`, and restores by PATCH to the same document
IDs. Prove the restore against a throwaway uid BEFORE erasing anything: a restore script you
have not exercised is not a backup. Done that way here: round trip was byte-exact on all 21 documents plus both singletons,
the account came back to 13 audits / 2 trackers / 6 EOBs / plan on file / "7 of 10 audits left",
and the only manual step afterwards was re-setting `ucr-skip-onboarding`, which is browser-local
and therefore outside the Firestore snapshot.
**Use case:** "erase all my data" means a genuinely fresh account, including the first-run setup screen.
**Data:** none (destructive — run it last, or on a scratch account).

1. With a plan on file and having previously clicked "Skip for now" at least once, open **☰ → Reset account — erase all my data** and confirm.
   ✓ After the reload you land on "**Set up your plan**", not the audit page — the onboarding skip flag is cleared along with the Firestore data.
   ✓ The skip link reads the first-visit wording ("Skip for now — audit a bill first").
   ✓ Audits, saved EOBs, trackers, and the plan are all gone; today's usage counters are intentionally NOT reset.
2. Contrast with **E3 (Remove the plan)**: removing just the plan leaves you on the bills page with the dashed "No plan on file · Add now" reminder under "Your coverage" — deliberate, since removing a plan is a deliberate act, not a fresh start.
3. ✓ Daily counters survive: immediately after a reset, the audit and plan-upload allowances are unchanged (reset is not a way to buy more audits).

**Cost:** 0 audits.

## R2 — Home routing, the short "Worth disputing" label, and the pairing summary
**Use case:** the bills list is the app's home, the found-money card says one thing, and the pairing summary names the EOB a run would actually use.
**Data:** none — run against whatever audits already exist. Needs a saved EOB in the library (any pass after M4).

1. Sign out and back in (with a plan on file). ✓ You land on **Bills & coverage**, never on the audit form, and the list is already populated — no flash of "No bills audited yet" while the query runs.
2. ✓ The feedback bubble is visible here, as it is on the audit form and reports.
3. Open any report. ✓ The fourth totals card reads exactly "**Worth disputing**" — not "Worth disputing — money you may not owe; hold off paying this part".
4. ✓ Both exits work: **the logo** returns to the list; "New audit" goes to the form, from which the logo also returns. *(Until 2026-08-31 each screen also carried its own "← Back to bills"; the logo replaced all three.)*
   ✓ **A report has a back link ABOVE the fold**, matching the audit form — not only at the
     bottom of the action row. A report runs well over a screen, and a single exit at the end
     meant scrolling back through the whole thing to leave.
   ✓ **The logo returns to the bills list while signed in** and does not leave for the marketing
     page. It is the only control visible from every screen, and it is the first thing people
     click to get home. Signed out it still goes to `/`, which is correct when there is no home
     to return to.
5. ✓ From the list, "**Audit a new bill**" shows "EOB on file: …" when the library has one, and its "Start an audit →" opens the form with the previous run's files cleared.
6. **Pairing summary tells the truth about the EOB.** On the audit form, stage two bills with no EOB file, and confirm a saved EOB is selected in the dropdown.
   ✓ The summary reads "**2 audits**: 0 bill+EOB pairs, 2 **with your saved EOB**" — not "no matching EOB", which is what it used to say even though the run does attach the saved EOB to every bill.
   ✓ Tick "**I don't have an EOB**": the summary changes in place to "2 with **no** EOB". Untick it, re-pick the saved EOB: it changes back. The summary and the run must never disagree about which EOB is in play.
   ✓ Confirm on the review screen that the saved EOB is actually there — it appears as its own tab, labelled "saved: …".
7. **Clean up**: remove both staged bills with their **✕**.

**Verified on production 2026-08-25:** all six steps.
1. Full sign-out → password sign-in round trip landed on **Bills & coverage**, never the audit
   form. Sampling the DOM every 150ms for 10.5s caught **no flash of "No bills audited yet"** —
   the only sections seen were `signin` then `bills`.
2. The feedback bubble (`#fb-bubble`) is visible on the bills list, the audit form and reports.
3. The fourth totals card reads exactly "**Worth disputing**" — "$2,115.00 / $841.75 / $186.35 /
   $804.15" with no trailing explainer.
4. Both exits work, and the logo returns to the list from the audit form.
5. "EOB on file: TESTVILLE BEHAVIORAL HEALTH ASSOCIATES · 2026-02-12" shows on the list card, and
   the form opens with the previous run's files cleared.
6. The pairing summary told the truth throughout: with a saved EOB selected, "**3 audits**: 0
   bill+EOB pairs, 3 **with your saved EOB**"; ticking "I don't have an EOB" changed it in place
   to "3 with **no** EOB"; unticking and re-picking changed it back. Bills accumulated one at a
   time (nothing replaced), and removing each with **✕** returned the button to "Prepare audit →"
   and hid the summary.

**Cost:** 0 audits (back out of step 6 with **Start over** if you got as far as a review).

## F1 — Feedback widget
**Use case:** in-app feedback reaches the founder without leaving the app.
**Data:** none.

1. On the audit page (or a report), find the teal **chat bubble** bottom-right. ✓ It does NOT appear on the sign-in, onboarding, processing, or review screens.
2. Click it → card opens: "Send feedback", Bug/Idea/Other pills, textarea, Send.
3. Pick a category, type a note, Send.
   ✓ "Thanks — we read every note." and the card closes itself.
   ✓ The submission appears in the Firestore `feedback` collection (console or CLI) with uid, email, message, category, screen, and — when sent from a report — the auditId.

**Verified on production 2026-08-25:** sent from the bills list and again from a report. The
card showed "Sending…" → "**Thanks — we read every note.**" → closed itself. Both landed in the
Firestore `feedback` collection with uid, email, message, category, platform and screen. The
report-sent one carried `screen: "report"` and `auditId: "77nVGeQlmA5R7Z2cZcmh"`; the
list-sent one carried `screen: "bills"` and `auditId: null` — the auditId is attached only where
there is one to attach.

**Cost:** 0 audits (20 feedback/day limit).

# Auth

## A1 — Three ways in, and the failures a real person hits
**Use case:** the two ways into the app. Password sign-in was added 2026-08-25; the email
link was removed 2026-08-26 (see step 4).
Most of this plan is the failure paths, because those are what a member sees when something
goes wrong and they are where the raw Firebase strings used to leak through.
**Data:** a throwaway address, e.g. `fam-test@useclaimright.test`.
**Prerequisite:** Firebase Console → Authentication → Sign-in method → **Email/Password** enabled.

1. **Create an account.** Enter email and a password, click "Create an account" (the button
   becomes "Create account"), submit. ✓ Signed straight in, landing on onboarding.
   ✓ The toggle now reads "I already have an account", and "Forgot password?" is hidden —
   it makes no sense in sign-up mode.
2. **Sign out**, then sign back in with the same credentials. ✓ Works.
3. **Google** still works, and lands the same place.
4. ~~**Email link**~~ — **REMOVED 2026-08-26.** ✓ The sign-in card offers exactly two routes:
   "Continue with Google" and email + password. There is no "Email me a link instead" link, and
   no `prompt()` anywhere in the app. See the note below for why it went.

**Edge cases — each must show OUR copy, never a raw `Firebase: Error (auth/…)` string**
- Wrong password → "That email and password don't match. Check both, or reset your password."
- Unknown email, sign-in mode → **"That email and password don't match. Check both, or reset your
  password."** — the SAME message as a wrong password, deliberately. Firebase's email enumeration
  protection returns `auth/invalid-credential` for both, so the app cannot tell them apart and
  must not appear to. *(This plan originally asserted "No account with that email…", which is
  what the `auth/user-not-found` mapping in app.js would produce. Running it on production
  2026-08-25 showed that mapping is unreachable while enumeration protection is on. The
  shipped behaviour is the better one and the plan was corrected, not the code.)*
- Existing email, sign-up mode → "That email already has an account — sign in instead."
- Password under 6 characters → "Passwords need to be at least 6 characters."
- Malformed address → "That doesn't look like an email address."
- Empty email / empty password → asks for the missing one, and makes no network call.
- **Provider switched off** in the Console → "Password sign-in isn't switched on for this app
  yet. Use Continue with Google." Not a message blaming the member for a config problem.
- **Reset does not leak account existence:** "Forgot password?" with an address that has NO
  account ✓ shows the same "check your inbox" as one that does. Anything else turns the form
  into an account-existence oracle.
- **Enter submits** from both the email and the password field.
- **The button disables while in flight** — double-clicking must not fire two attempts.

**Cost:** 0 audits.

**Verified on production 2026-08-25:** cases 1, 3, 4, 5, 6, 7, 8a, 8b, 8c, 9, 10 and the
in-flight button disable all pass, with our copy in every case and never a raw Firebase
string. Case 5 corrected as above.

**Step 3 (Google) verified on production 2026-08-26** by the owner. Identity Toolkit confirms
the account carries the `google.com` provider and a fresh `lastLoginAt`; no sign-in error
appeared, and it landed on **onboarding — "Set up your plan"**. That IS "the same place":
this Google account has no plan and no audits, so the empty-account route is correct and
matches what password sign-up does in step 1. The routing is shared (`onAuthStateChanged`),
so the assertion is that the provider does not change it, and it does not.

**Step 4 (email link) — the app is correct, the EMAIL DOES NOT ARRIVE. Investigated 2026-08-26.**
The owner requested a link and never received it. This is a delivery problem, not an app bug,
and every layer was checked:

- The client call succeeded: `sendSignInLinkToEmail(auth, email, { url: location.href,
  handleCodeInApp: true })` resolved without throwing, "Link sent — check your inbox on this
  device." rendered, and `emailForSignIn` was written to localStorage. A rejected request would
  have thrown and shown our error copy instead.
- Auth config is right: `email.enabled: true`, `passwordRequired` unset (so links are
  permitted), and `useclaimright.web.app` is an authorized domain.
- The link pipeline itself works. Generating one through the admin API
  (`accounts:sendOobCode` with `returnOobLink: true`, which returns the link instead of mailing
  it) produced a valid `mode=signIn` link with `continueUrl=https://useclaimright.web.app/app`.

So the code, the config and the link are all fine; the message is not reaching the inbox. The
cause is Firebase's DEFAULT email sender: `notification.sendEmail.method` is `DEFAULT` with no
SMTP configured, so mail goes out as **noreply@useclaimright.firebaseapp.com** — a domain with
no SPF/DKIM alignment to useclaimright.com. Gmail routinely spam-files or silently drops it.

To finish the test: search the mailbox for `from:noreply@useclaimright.firebaseapp.com`
including Spam and All Mail. To fix it properly: Console → Authentication → Templates → SMTP
settings, pointed at a real sending domain with SPF/DKIM.

**Resolved by removal, 2026-08-26.** Rather than configure SMTP for a launch that has not
happened, the email-link path was deleted: the `use-email-link` control, the `email-sent`
copy, the `sendSignInLinkToEmail` / `isSignInWithEmailLink` / `signInWithEmailLink` imports and
both handlers. That also removed the **last native `prompt()` in the app**, which had been the
one remaining renderer-blocking dialog and the reason this path could never be automated. Two
sign-in routes remain, both verified. The Firebase provider is left enabled — no client code
calls it, and disabling it in the Console would also disable email+password, which is in use.

**Provider-switched-off verified on production 2026-08-26 — A1 is now complete.** Rather than
click through the Console, `signIn.email.enabled` was set to `false` through the Identity
Toolkit admin API, the message captured, and the flag restored within about a minute. With the
provider off, a password sign-in returned exactly:

> "Password sign-in isn't switched on for this app yet. Use Continue with Google."

No raw `Firebase: Error (auth/…)` string, and the app stayed on the sign-in screen rather than
half-navigating. The config came back to `{"enabled": true}`, byte-identical to what it was
before, and a password sign-in immediately succeeded to the bills list with 26 audits intact.

Note for anyone repeating this: setting `enabled:false` causes the API to add
`passwordRequired: true` as a side effect, so restoring needs an updateMask covering **both**
`signIn.email.enabled` and `signIn.email.passwordRequired`, or you will leave the project in a
state it did not start in. While the provider is off, every password account is locked out —
Google sign-in is unaffected, which is what makes this safe to do at all.

# Family, scans, and real documents

## FAM1 — Two family members are not one person billed twice
**Use case:** a household shares a plan, a clinic and a day. Before 2026-08-24 the second
audit reported "a provider billing you twice for one visit" and told the user to dispute a
charge they legitimately owe. This is the plan that must never regress.
**Data:** `family/matthew-bill.pdf`, `family/sarah-bill.pdf`, `family/family-eob.pdf`.
Both bills: flu vaccine 90686, $85.00, 03/10/2026, Testville Family Medicine Associates.
**Both bills name Matthew as GUARANTOR** — that is the trap, and it is deliberate.

1. Audit `matthew-bill.pdf` + `family-eob.pdf`.
   ✓ Report renders. The bill demands $85.00 where the EOB allows $32.00 and says you owe
   $0.00, so **Worth disputing ≈ $85.00**, one `billed_vs_allowed_mismatch`, high confidence.
2. **New audit.** Audit `sarah-bill.pdf` + `family-eob.pdf`. ✓ Same shape, ≈ $85.00.
3. **Click the logo** to return to the bills list.
   ✓ **NO duplicate hero. No `FOUND BY COMPARING YOUR BILLS TO EACH OTHER` ribbon.**
   ✓ The provider group reads "**2 bills · $170.00**", both rows "Billed above EOB allowed amount".
3b. ✓ **The dashboard names who each bill is for.** Under Testville Family Medicine the two rows
   read **Matthew** and **Sarah** beside the date. *(Added 2026-08-31: `patientName` was extracted
   and stored but never rendered, so two family members seen the same day for the same code
   showed as identical rows. Shown only when the history holds more than one person — a name on
   every row of a single-person account is noise. First name only, falling back to the full name
   if two members share one; an audit predating `patientName` shows "—".)*
4. Open each audit and confirm the patient it was attributed to.
   ✓ One is **Matthew T. Testpatient**, the other **Sarah L. Testpatient** — read from the
   *patient* field. If both say Matthew, the model took the **guarantor** and the fix is
   broken even though step 3 may still look right by luck.

**Edge cases**
- **The control:** audit `emma-bill.pdf` + `family-eob.pdf`. Its 99213 is billed **twice on one
  statement**. ✓ A `duplicate_charge` of $210.00 IS reported. A change that suppresses
  duplicates wholesale passes steps 1–3 and fails here. *(+1 audit)*
  **Verified on production 2026-08-25:** duplicate reported at $210.00, high confidence —
  "the itemized bill lists code 99213 twice for the same date of service, whereas the EOB
  lists only one office visit claim line". Totals $420.00 billed / $118.00 allowed / $30.00
  responsibility / **$390.00 worth disputing** ($210 duplicate + $180 billed-above-allowed,
  with the $30 copay correctly excluded).
- **Same person, two statements:** re-audit `matthew-bill.pdf` against the same EOB. ✓ Same
  `billKey`, so still no duplicate — re-auditing one bill is the user re-running us, not a
  double-bill. *(+1 audit)*
- ~~⚠️ **Known gap:** the same paper as a PDF and as a SCAN did not share a `billKey`~~ —
  **FIXED 2026-08-26.** It used to report "the same visit is on two statements" for a bill that
  exists once, because `billKey` hashed normalised text and the scan path returns the model's
  transcription, which differs from pdf.js by far more than whitespace. The model now extracts
  `statementId` and the key is built from that. Re-verified with t6 as a PDF and as a 110dpi
  PNG: same key, not flagged. See the billKey section near the top of this file.
- **Empty patient name:** any pre-2026-08-24 audit in history has no `patientName`. ✓ Those
  still participate in duplicate detection exactly as before (empty names share a key).

**Verified on production 2026-08-29:** Matthew `ACCT-FAM-101` and Sarah `ACCT-FAM-102`, both
$85.00 / $32.00 / $0.00 / $85.00, attributed to **Matthew T. Testpatient** and **Sarah L.
Testpatient** from the statements. **No duplicate hero named either of them** — two family
members seen the same day for the same code stayed two bills.

**A different false positive surfaced on the same screen** (fixed, see below): the only hero
present named `t5`, a bill audited twice — once in E2 without an EOB, once in M7 with one.

**Cost:** 2 audits, +2 for the edge cases.

**Verified on production 2026-08-25** (useclaimright.web.app, real Gemini calls): both audits
returned $85.00 `billed_vs_allowed_mismatch` at high confidence, and the dashboard showed
"2 bills · $170.00" with **no duplicate hero and no ribbon**. Step 4 confirmed the stored
documents carry `patientName` "Matthew T. Testpatient" and "Sarah L. Testpatient" —
read from the patient field, not the guarantor, which on both bills is Matthew.
`droppedUnverified` 0 on both. The Emma control was also run; see the edge cases.

## FAM2 — A family plan measures against the FAMILY deductible
**Use case:** a plan states two limits and a household accrues against one. Reading
`.individual` unconditionally rendered a household 64% through a $1,000 family deductible as
**128%** of a $500 individual one, and reported the EOB's correct figure as a conflict.
**Data:** FAM1's audits, plus any `real-sbc/*.pdf` on file (all are Coverage for: Family,
$500 individual / $1,000 family, $2,500 / $5,000 OOP). `family-eob.pdf` states
**$640.00 of $1,000.00** family deductible met.

1. With a real SBC on file (P1) and FAM1's audits run, go to **Bills & coverage → Your coverage**.
   ✓ The deductible card reads **$640 of $1,000**, not $640 of $500.
   ✓ It does **not** render past 100%.
   ✓ **No conflict warning** — the family figure is the plan, not a disagreement with it.
2. ✓ The out-of-pocket card resolves the same way against the family maximum.

**Verified on production 2026-08-25**, with `real-sbc/cms-2019.pdf` on file: the deductible
card read **$640.00 of $1,000.00** (the family figure, not the $500 individual one) and the
out-of-pocket card **$640.00 of $5,000.00 · 13%** (family, not the $2,500 individual). Before
the fix these rendered as 128% and 26% of the individual targets. The card also surfaced an
honest conflict note — "your EOBs' per-claim amounts sum to $0.00 — the insurer's running
total disagrees" — which is correct: the family EOB states $640 met while its individual
claim lines applied $0 to deductible.

**Edge cases**
- **Individual-scope EOB:** an EOB stating a $500 limit ✓ resolves to individual, no conflict.
- **Genuine conflict:** an EOB naming a figure matching *neither* ($3,000) ✓ still warns, and
  ✓ the SBC still owns the limit — precedence is unchanged, only scope selection was fixed.
- **No EOB figure at all:** ✓ falls back to individual. That is the single-member case and the
  conservative one: too low warns early rather than late.

**Cost:** 0 audits.

## FAM3 — A consolidated EOB pairs with a differently-named bill
**Use case:** nobody renames their downloads. A household EOB is `family-eob.pdf` or
`EOB_20260325.pdf`; the bill is named for the patient or the clinic. Pairing grouped by
filename stem, so the two never matched — and the app said "Add your EOB" while the EOB sat
on screen with a tick next to it.
**Data:** `family/matthew-bill.pdf` + `family/family-eob.pdf` (stems "matthew" and "family").

1. Stage the bill on the bill zone and the EOB on the insurance-letter zone.
   ✓ Both appear as "✓ file ✕" rows.
2. Click **Prepare audit →**.
   ✓ It reaches the **review** screen. ✓ **No** "Add your EOB (step 1)…" error.
3. **Start over** to back out without spending an audit.

**Verified on production 2026-08-25:** `matthew-bill.pdf` + `family-eob.pdf` reached the
review screen with no error.

**Edge cases**
- **Ambiguity is preserved:** stage two bills and one unmatched EOB. ✓ The EOB stays orphaned
  and the error asks for the missing one — with two candidates there is nothing to infer, and
  guessing would pair the wrong documents.
- **Matching stems unaffected:** `t3-bill.pdf` + `t3-eob.pdf` ✓ still pair by stem.

**Cost:** 0 audits.

## FAM4 — The wrong family member's EOB
**Use case:** a household has three EOBs in the downloads folder. They are the same payer, the
same clinic, the same date and the same layout; the only thing that separates them is the patient
name on the claim. Grabbing the wrong one is the likeliest mistake a family makes.
**Data:** `by-plan/FAM4-wrong-family-members-eob/` — `matthew-bill.pdf` (90686 flu shot, 2026-03-10,
$85.00) paired with **`sarah-eob.pdf`** (Sarah's own statement for *her* flu shot, same code, same day).

**Why this is the hard case.** Every other family plan pairs a bill with the *consolidated*
`family-eob.pdf`, which legitimately covers everyone — so they test that we do **not** false-positive
across members. Nothing tested the other direction. `documentsRelated` compares **service dates and
procedure codes only**, and this pair shares both exactly, so the mismatch guard sees "related" and
stays silent. Saved EOBs do not store `patientName` either, so there is nothing to compare even if
the guard wanted to.

1. Audit `matthew-bill.pdf` + `sarah-eob.pdf`.
   ✓ The audit completes. Record the four totals cards.
   ✓ **The question this plan exists to answer:** does anything tell the member the EOB belongs to
   someone else? Check, in order:
   - the mismatched-pair warning on the report (expected **not** to fire — dates and codes match)
   - the finding list, for anything naming the patient
   - the stored audit's `patientName` (from the *bill*, so "Matthew T. Testpatient")
2. ✓ Whatever the model says, the **guard** is what is under test. Record which of the three
   noticed, if any.

**Verified on production 2026-08-31 — and the result is worse than "nothing fires".**

| Card | Got |
|---|---|
| Billed | $85.00 |
| EOB allowed | **$0.00** |
| Your responsibility | **$0.00** |
| Worth disputing | **$85.00** |

One finding, `not_in_eob` $85.00 at **high** confidence, and the mismatch warning **suppressed**:

```
documentsRelated -> { related: true, confident: true,
                      sharedDates: ["2026-03-10"], sharedCodes: [] }
```

The shared service date alone was enough to call the pair related. So the app does not merely
stay quiet — **it tells the member to dispute $85.00 they owe nothing on**, because the charge is
covered on a different statement. Same harm direction as the `statementId` false-duplicate: the
product's worst failure is telling someone not to pay a bill that is correct.

`patientName` on the audit was read correctly as **Matthew T. Testpatient**. The information
needed to catch this was present and unused.

**⚠️ The obvious fix does not work.** Sarah's EOB names *both* people — Sarah on the claim line,
Matthew in the subscriber block, because he is the subscriber for the household. So "is the bill's
patient named anywhere in the EOB?" passes on a wrong pair and would guard nothing. The comparison
has to be against the **claim-level** patient, not the document text.

**That is the finding, not a failure of the test** — it turns an invisible gap into a reproducible
one.

### Fixed and re-verified on production 2026-08-31

The model now returns **`eobPatients`** — the people the EOB's *claims* are for, read from the
claim lines and explicitly **not** from the subscriber block. `wrongPatient()` compares the bill's
patient against that list, matching on surname plus first name so "TESTPATIENT, MATTHEW T" and
"Matthew Testpatient" are one person, and returns false whenever it cannot tell. Saved EOBs now
store `patients` too, and `eobPatients` is written to the audit so a **re-opened** report warns
identically to a fresh one.

Re-run of the same pair:

> ⚠️ **This EOB is for someone else.** The bill is for **Matthew T. Testpatient**, but this
> statement covers **Sarah L. Testpatient**. Charges here will look "missing from the EOB" simply
> because they sit on a different statement.

The prompt change improved the model's own reasoning as a side effect — the finding now reads
"absent from the EOB, **which only contains claims for a different patient**", which it did not
say before being asked for claim-level names.

✓ The warning outranks the generic mismatched-pair copy, which would have been **false** here:
a household's documents *do* share dates and codes.
✓ **FAM1 must still pass** — the consolidated `family-eob.pdf` lists all three members, so
`wrongPatient` returns false and no warning appears on a correct pair. The fix has two halves, neither built yet:
store `patientName` on saved EOBs, and compare people in `documentsRelated` alongside dates and
codes (carefully: "TESTPATIENT, MATTHEW" and "Matthew T. Testpatient" are the same person, and a
false "wrong patient" warning on a correct pair is worse than silence).

**Cost:** 1 audit.

## S1 — A scan is read by the model, not OCR'd locally
**Use case:** tesseract was removed 2026-08-23. Pages with no text layer go to the model as
images, and the model returns its transcription — which is what history, the bill fingerprint
and saved-EOB matching then run on.
**Data:** photograph a bill, or rasterize one: `pdftoppm -png -r 150 test-fixtures/fake-bill.pdf out`.

1. Upload the photo. ✓ Processing is quick and there is **no model download** (the 500MB NER is gone).
2. On review: ~~✓ the **📷 banner** appears.~~ **Removed 2026-08-28** — every document is
   sent as pages now, so a banner announcing it was permanently on and carried no text. ✓ The right pane does **not** show extracted text —
   it explains the pages are sent as images and says what to check.
3. Analyze. ✓ Findings return with quoted evidence.
4. ✓ The audit appears in history with a readable summary, which is only possible if the
   model's transcription was stored.

**Verified on production 2026-08-25** with a 110 DPI rasterisation of `emma-bill.pdf`
(no text layer) paired with `family-eob.pdf`: the 📷 banner fired, the bill tab showed the
page image beside the scan explanation rather than an empty text box, the EOB tab showed its
extracted text, and the audit found the duplicate 99213 **from the image** at $210.00.

**This is the plan that caught the mixed-document bug.** On the first run the EOB was silently
dropped — EOB allowed $0.00, "the billed services are missing from an EOB", worth-disputing
inflated to $630.00. `runAudit` branched once for the whole request, so one image discarded
every text document. Fixed, redeployed, re-run: EOB allowed $118.00, a real billed-above-
allowed finding of $390.00, worth-disputing $600.00. Regression covered by
`functions/test/parts.test.js`.

**Edge cases**
- ~~**Mixed:** a digital-PDF bill with a photographed EOB. Bill goes as text, EOB as images.~~
  **Stale since PDFs became page renders** — a digital PDF and a photo now take the identical
  path, so there is no mix left to test. The only text/image mix still reachable is an HTML or
  `.txt` upload beside an image, which no member does. See IMG1 for what replaced this.
- **Too many pages:** more than 20 page images ✓ rejects with a page-count message, before any
  model call is billed.
- **Upside down / cut off:** ✓ the banner tells the user to check exactly this, because the
  model cannot.

**Cost:** 1 audit.

## IMG1 — Image edge cases (0 audits)
**Use case:** every real document is now an image. A PDF from a portal and a phone photo both
go to the model as page renders; only HTML and `.txt` stay text, and no member uploads those.
So the image path is not a corner case any more — it is the product.
**Data:** `by-plan/IMG1-image-edge-cases/`, generated by `node test-fixtures/gen-by-plan.mjs`.

Every check here stops at the review screen. **Back out with "Start over" — none of this costs
an audit.** Extraction is what is under test, not the model.

| File | Expected |
|---|---|
| `01-normal-scan.png` | ✓ one page render, `method: "image"`, text empty |
| `02-rotated-90.png` | ✓ accepted; the page appears sideways in the review pane — **this is the point**: the reviewer must be able to see it is unreadable before spending an audit |
| `03-upside-down.png` | ✓ accepted, shown upside down, same reasoning |
| `04-iphone.heic` | ✓ refused with the HEIC message naming Settings → Camera → Formats, **not** the generic "unsupported file type" |
| `05-screenshot.png` | ✓ a portal screenshot is a normal image upload |
| `06-low-res.png` | ✓ accepted; legibility is the reviewer's call |
| `07-full-res-phone.png` | ✓ a 12MP-class image; JPEG re-encoding keeps the payload well under the limit |
| `08-eob-page-*.png` | ✓ several images as one document — all pages listed, pills switch between them |

**Verified on production 2026-08-28** by calling `extractText` directly on each file:

| File | In | Type Chrome reports | Result |
|---|---|---|---|
| 01-normal-scan | 176 KB | `image/png` | 1 image, 206 KB b64, 42 ms |
| 02-rotated-90 | 209 KB | `image/png` | 1 image, 205 KB b64 |
| 03-upside-down | 172 KB | `image/png` | 1 image, 204 KB b64 |
| **04-iphone.heic** | 90 KB | **`application/octet-stream`** | **refused** |
| 05-screenshot | 94 KB | `image/png` | 1 image, 78 KB b64 |
| 06-low-res | 36 KB | `image/png` | 1 image, 30 KB b64 |
| 07-full-res-phone | 891 KB | `image/png` | 1 image, **624 KB** b64, 146 ms |

**The HEIC finding.** Chrome maps no MIME type to `.heic`, so it missed the `image/*` branch and
fell through to *"Unsupported file type: application/octet-stream. Use PDF, photo, HTML, or
text"* — telling someone who just uploaded a photo to upload a photo. HEIC has been the iPhone
camera default since iOS 11, so this is the likeliest failure a real member hits on the likeliest
path. Chrome cannot decode HEIC, so `extract.js` now names the format and gives the two ways out
rather than pretending.

**Still not covered, deliberately named rather than left implied:**
- **EXIF-rotated JPEG.** `02` rotates *pixels*; a real phone photo is stored upright with an
  orientation tag instead. `createImageBitmap` should honour it, but that is untested here.
- **A photo of a screen** (moiré, glare) and **a folded/creased page** — both realistic, neither
  reducible to a fixture that proves anything without a human judging the render.
- **Nothing downscales before upload.** 12MP re-encodes to 624 KB so it is not a problem today;
  a 48MP phone or a 20-page scan is the case that would find the ceiling.

**Cost:** 0 audits.

## P1 — Extraction works on documents we did not write
**Use case:** every other plan uses fixtures we authored, so they only prove extraction works
on our own assumptions. These are genuine CMS publications in the ACA-mandated format.
**Data:** `real-sbc/cms-2025.pdf`, `real-sbc/cms-2019.pdf`, `real-sbc/cms-older.pdf`.

1. Upload each as the SBC (3 separate plan uploads, one per day-limit).
   ✓ All three extract without error. Verified 2026-08-24:

   | file | plan year | deductible | OOP max | cost-share rows |
   |---|---|---|---|---|
   | `cms-2025.pdf` | 2025-01-01 → 2025-12-31 | $500 / $1,000 | $2,500 / $5,000 | 13 |
   | `cms-2019.pdf` | 2022-01-01 → 2022-12-31 | $500 / $1,000 | $2,500 / $5,000 | 15 |
   | `cms-older.pdf` | 2017-01-01 → 2017-12-31 | $500 / $1,000 | $2,500 / $5,000 | 17 |

2. ✓ Limits carry CPT hints (home health 60 visits/yr, rehabilitation).
3. ✓ **The 2017 and 2022 plans are out of period today** — an audit against them reports
   `out_of_period` rather than applying stale terms. That is the correct behaviour, and it makes
   `cms-2025.pdf` the one to leave on file for FAM2.

**Edge cases**
- **A SCANNED SBC** — rasterise `cms-2025.pdf` (`pdftoppm -png -r 150`, recombine to a PDF) so
  it has no text layer. ✓ The review screen shows the rendered pages and the plan extracts
  normally. *(The 📷 banner it used to mention was removed 2026-08-28 — every document is pages
  now, so a banner announcing it was permanently on.)*
  ⚠️ **This was broken until 2026-08-27 and nobody had tried it.** `prepareSbc()` built
  `state.bill` from the extraction WITHOUT `images`, so a scan sent empty text and empty
  images and the server answered "The SBC is required, as text or page images." A photographed
  plan document could not be uploaded at all. The audit path always carried images; this one
  did not. Found while measuring the image path, not by a plan — worth a step of its own now.
- **Wrong document on the SBC zone:** `real-eob/cms-sample-eob.pdf` is an EOB, not an SBC.
  ✓ Rejected with "This doesn't look like a Summary of Benefits."
- **DOL samples — pulled and run 2026-08-26, and they do not deliver what was hoped.**
  `dol-sample-2.pdf` (2018) and `dol-sample-3.pdf` (2022) both extracted cleanly on Vertex, but
  both carry the SAME $500 / $1,000 deductible and $2,500 / $5,000 OOP as the three CMS files —
  every government specimen SBC is the same plan. `dol-sample-3` still earns its place: its
  "overall deductible?" row extracts with **no dollar figures beside the question**, a layout
  that defeats text-adjacency parsing, and the model returned $500 / $1,000 anyway. Real
  variation in plan structure still needs a real member's SBC.

**Verified on production 2026-08-25** with `cms-2019.pdf`: extracted cleanly, plan on file as
"Insurance Company 1: Plan Option 1", 2022-01-01 to 2022-12-31, deductible $500 / $1,000.
Trackers were auto-created from its limits ("Children's eye exam 0/1", "Home health care
0/60", both tagged *from your plan (SBC) — check the codes*). Step 3 confirmed: the out-of-period
banner fired — "Your plan year ended 2022-12-31 — upload your new SBC." `cms-2025.pdf` and `cms-older.pdf` were
subsequently run on production against Vertex on 2026-08-26 — 2025-01-01 → 2025-12-31 and
2017-01-01 → 2017-12-31 respectively, both $500 / $1,000. All three CMS files are covered.
- **Wrong document (E4) does NOT clobber a good plan:** uploading `real-eob/cms-sample-eob.pdf`
  to the SBC dropzone was rejected with "This doesn't look like a Summary of Benefits." and
  the existing plan survived intact. Verified on production 2026-08-25.

**Cost:** 3 plan uploads, 0 audits.

## G1 — The spend guard stops model calls without a deploy
**Use case:** every other limit is per-uid, and accounts are free to mint. This is the only
thing bounding the bill.
**Data:** Firestore console, `meta/guard`.

1. Set `meta/guard.auditsEnabled = false`.
2. Try an audit. ✓ Fails with "**Audits are paused right now.**" ✓ No model call in the
   Functions log, so **nothing is charged**. ✓ No audit document is written.
3. Set it back to `true`. ✓ The next audit runs normally, with no deploy in between.

**Edge cases**
- **Independence:** `plansEnabled = false` with `auditsEnabled = true` ✓ blocks plan uploads
  only. Audits keep running.
- **Ceiling:** set `dailyCalls` to 1, run one audit, try a second. ✓ "We've hit today's limit
  across all users." Reset it afterwards — **the default is 2000**.
- **Failure is open, not closed:** the guard config failing to read must not take the product
  down; the per-uid limits stand behind it. Covered by `functions/test/guard.test.js`.
- **Counters are day-scoped:** yesterday's spend ✓ does not bar today.

**Cost:** 0 audits (the blocked attempts are refused before the model runs).

**Verified on production 2026-08-25:**
- Kill switch: `auditsEnabled=false` → audit refused in **637ms** with "Audits are paused
  right now." A Gemini round trip is 10-20s, so the latency itself proves no model call.
- Independence: with `plansEnabled=true`, a plan upload still reached the model (3,568ms)
  and returned a content rejection. Not everything switched off together.
- Ceiling, across shards: `dailyCalls=1` against 6 already spent → "We've hit today's limit
  across all users." in **499ms**. The 6 were spread over ten shards at 0-1 each, so a
  per-shard check would have let it through.
- Guard restored to `auditsEnabled/plansEnabled true, dailyCalls 2000` afterwards.

**Per-user daily cap (from Always-on), verified on production 2026-08-25:** the 11th audit
shows a **dialog, not a red error** — "That's today's 10 audits", explaining that every audit
is a real model call and "Capping it at 10 a day is what keeps it free for everyone".
Reset shown as **"5:00 PM today"**, in local time: server counters roll on the UTC date, so
"midnight" would be wrong for most people. Refused in **551ms**, before any model call. The
inline error remains underneath as the trace after the dialog is dismissed.

## billKey — same paper, two extractions (regression fixed 2026-08-26)

The failure: audit a bill as a PDF, then as a photo, and the dashboard announced "the same
visit is on two statements — you likely owe one, not both" for a bill that exists once. A false
accusation against a provider, carrying the member's name, in the place the headline figure
comes from.

`billKeyOf` hashed the bill's text, which identifies the EXTRACTION rather than the paper. A
scan returns the model's transcription, which differs from pdf.js output by far more than
whitespace, so the two hashed differently.

The fix is a `statementId` the model extracts verbatim — account, statement or invoice number —
preferred over the hash and keyed with the provider. The reasoning worth keeping: provider,
patient, date and codes are identical between "one bill audited twice" and "one visit billed on
two statements", so no combination of them can tell the two apart. Only the number printed on
the paper can, and because the model reads it, both input paths agree.

**Verified on production 2026-08-26.** `t6-bill.pdf` audited normally, then rasterised to a
110dpi PNG and audited again:

| | text path | image path |
|---|---|---|
| `statementId` | `ACCT-SER-006` | `ACCT-SER-006` |
| stored bill text | 406 chars | 437 chars — **differs**, which is what broke the old hash |
| `billKey` | `s11659ffa` | `s11659ffa` — **same paper** |

The dashboard did not flag the June 10 bill. To re-run this, always use a bill whose account
number is printed; `test-fixtures/series/*` all carry one.

⚠️ **Legacy audits are not retroactively fixed.** Anything stored before this change has no
`statementId` and still falls back to the text hash — 30 of 32 audits on the test account at
the time, which is why a stale Feb 12 duplicate still shows there. Judge this plan on bills
audited after the change, not on the existing dashboard.

## Vertex AI re-verification (2026-08-26)

The backend moved from the Gemini Developer API to Vertex AI on 2026-08-25, which invalidated
every model-dependent result in this file. All of them were re-run on Vertex. **Every plan
reproduced its documented figures**, with two exceptions noted below — neither a Vertex fault.

| Plan | Result on Vertex |
|---|---|
| E1 | $2,115.00 / $841.75 / $186.35 / **$804.15** — `duplicate_charge` 145.50 + `billed_vs_allowed` 658.65 |
| M2 | $210.00 / $95.00 / $95.00 / **$150.00** — $115 high + $35 medium, SBC quote verbatim |
| M3 | $175 / $120 / $120 / **$55**, one finding, **zero plan-mismatch**, `planApplied` with `planReason: null` |
| M4 | JUST AUDITED "2 bills · $110.00", $55 each; `serviceDates` held **only each bill's own date**; no `deductible_misapplied` |
| M5 | "matched by provider", missing claim flagged, **no** mismatched-pair warning (the E6 discrimination) |
| M7 | remark banner fired verbatim, including the benefit name between "5 of 6 covered" and "visits" |
| E2 | $175.00 / $0.00 / $0.00 / **$0.00**, zero findings |
| E6 | review **and** post-run warnings both fired; worth disputing **$2,115.00 = billed** |
| S1 | 📷 banner, `patientName: "Emma R. Testpatient"` read **from the image**, EOB allowed **$118.00** (mixed-document regression did not recur) |
| FAM1 | **Matthew T.** and **Sarah L. Testpatient** — the guarantor trap held; family pair not flagged as duplicates |
| E4 | **first run ever**: "This doesn't look like a Summary of Benefits.", existing plan left untouched |
| P1 | all three CMS SBCs: **2025**, **2022**, **2017** periods, each $500/$1,000 deductible, $2,500/$5,000 OOP, limits carrying CPT hints |

**Two things this run turned up.**

1. **S1's documented figure was itself the over-total bug.** The plan recorded worth-disputing
   **$600.00** on a **$420.00** bill as the expected result. On this run the findings summed to
   $605.00 and the new billed cap returned **$420.00**. The suite had enshrined an instance of
   the defect fixed on 2026-08-25 as the correct answer. Containment did not fire here (the
   lineRefs do not nest) — this is the cap doing exactly the backstop job it exists for.
2. **P1's cost-share row counts drift between runs.** cms-2025 extracted 15 rows against 13
   documented, cms-2019 11 against 15. Deductible, OOP maximum, plan period and the CPT-hinted
   limits were all exact. Counting rows in a scanned benefits table is the softest thing the
   model does, so treat that column as indicative and the money figures as the assertion.

**Not re-run, because they make no model call** and so cannot be affected by the backend:
E1b, E3, E5, M6, D1, R2, F1, X1, E7, A1's password paths, FAM2, FAM3, G1. Their existing
verification blocks stand.

## PAY1 — Buying an appeal letter (sandbox only)

**Use case:** the one paid thing in the product. Audits are free; the letter is $4.99.
**Prerequisite:** `PAYMENTS=on` in `functions/.env` and a redeploy, plus sandbox
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Confirm it is really on: an unsigned POST to
the webhook returns **400** (on, rejecting the signature) rather than **503** (off).
**Data:** any audit WITH findings. A clean audit is free by design and cannot be used here.

**Stripe test cards** — any future expiry, any CVC, any postcode:

| Card | What it does |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 9995` | declined, insufficient funds |
| `4000 0025 0000 3155` | requires 3-D Secure — tests the authentication step |

1. **The gate.** Open a report with findings, click **Generate dispute email**.
   ✓ The **paywall card** appears — "Unlock this appeal letter", the button reads
     **"Unlock this letter — $4.99"**, and it says auditing stays free and there is nothing to
     cancel.
   ✓ **No raw error message**, and **no letter text anywhere on the page** — check the
     dispute-email box is still empty. The letter must not exist client-side before payment.
2. **Cancel path.** Click the button, then use the back arrow on Stripe's page.
   ✓ You land back on the app with the paywall still showing and **no charge** in Stripe.
3. **Buy it.** Click the button again, pay with `4242 4242 4242 4242`.
   ✓ Stripe's page shows "UseClaimRight appeal letter", **$4.99**, and a Sandbox badge.
   ✓ You are returned to the app, the paywall disappears, and the letter appears with your own
     bill and EOB quoted.
   ✓ The address bar is **clean** — no `?paid=1` left behind.
4. **The double-charge guard.** Refresh. Then leave the report and re-open the same audit, and
   click Generate again.
   ✓ The letter comes back **free every time**. No paywall, no second charge.
   ✓ Stripe shows exactly **one** payment.
5. **The unlock is per-audit.** Open a DIFFERENT audit with findings, click Generate.
   ✓ The paywall appears again. Buying one letter does not buy them all.
6. **A declined card.** On a fresh audit, buy with `4000 0000 0000 0002`.
   ✓ Stripe refuses on its own page; you are not returned as paid, and the letter stays locked.
7. **A clean audit is never sold.** Open an audit with NO findings, click Generate.
   ✓ "Good news — this audit found no discrepancies…" with **no paywall**. Charging for a null
     result would be indefensible.
8. **Stripe's own records.** Dashboard → Payments, and Developers → Webhooks → your endpoint.
   ✓ One succeeded payment per purchase, and webhook deliveries showing **200**.
   ✓ A delivery that shows 400 means the signing secret does not match the endpoint.

**Cost:** $0 real money — sandbox only. Uses no audits.

⚠️ **Switch it off when you are done:** set `PAYMENTS=off` in `functions/.env` and redeploy.
**Deleting the file does NOT work** — a deployed function keeps env vars from previous deploys,
so the flag must be set to off explicitly. Verify by POSTing an unsigned body to the webhook and
seeing **503**. Leaving it on means the public site gates letters behind a checkout that only
accepts test cards.

## REV1 — The review screen shows the pages we send

**Use case:** the review is the consent gate — "this is what we send" — and where a wrong EOB
is caught before an audit is spent.
**Changed 2026-08-27, twice.** First the raw text dump became a summary; then the text layer
was removed entirely, so the pages ARE what is sent and there is nothing to compare them
against. The screen is now one document, shown large.

1. Upload a **one-page** bill, Prepare audit.
   ✓ Heading reads "**This is what we send**".
   ✓ The page is shown large, and there are **no page pills** — a "1" pill is a control that
     can do nothing.
2. Add a **multi-page** document (`real-sbc/cms-2025.pdf` is 5 pages) and switch to its tab.
   ✓ **Five numbered pills**, page 1 active. Clicking pill 3 shows page 3 and moves the
     highlight. Switching tabs resets to page 1.
3. Upload a **.txt or .html** file.
   ✓ No pills and no page view — there is nothing to render, so the text itself is shown. This
     is the only path where text is still what gets sent.
4. ✓ A **saved EOB** says its text was kept but the file was not, so there are no pages.

**Cost:** 0 audits — back out with **Start over**.

## PHONE1 — Phone layout (0 audits)
**Use case:** the app is designed against a 960px column. This is what that assumption costs on
a 375px screen, measured rather than eyeballed.
**How:** Chrome's window will not go below ~1232px of viewport, so use **Playwright at 375×844**
or **Cmd+Shift+M** in DevTools. A real iPhone SE simulator (`xcrun simctl boot "iPhone SE (3rd
generation)"`, then `xcrun simctl openurl … <url>`) is better still for anything iOS-specific.

| Check | Expected |
|---|---|
| horizontal overflow | **0** elements past the viewport, `scrollWidth === clientWidth` |
| form controls | **none under 16px** — iOS Safari zooms the page on focus below that |
| tap targets | nothing under 44px except inline links inside prose paragraphs |
| totals order | **"Worth disputing" first**, not fourth |
| content width | the totals column is ~309px of 375, not ~269px |

**Verified 2026-08-28** at 375px, before → after:

| | Before | After |
|---|---|---|
| controls under 16px | 8 | **0** |
| tap targets under 44px | 44 | **2** (both reCAPTCHA attribution links, left deliberately) |
| totals content width | 269px | **309px** |
| hero card position | 4th | **1st** |
| horizontal overflow | 0 | 0 |

The two remaining short targets are Google's reCAPTCHA "Privacy Policy" and "Terms of Service"
links. They are inline in a wrapped 12px paragraph, where a 44px band would overlap its
neighbours and break the prose — left short on purpose, not missed.

**Cost:** 0 audits.

## TAP1 — One rule for what is tappable

**Use case:** three different click affordances on one screen taught people three different
things. Changed 2026-08-28 to a single rule: **if a card or row exists to do ONE thing, the
whole card or row is the target.** Destructive controls are the exception — they stay their own
target, with room around them.

| Target | Before | After |
|---|---|---|
| "Audit a new bill" card | a 161×42 button inside a 912px card — **18%** | the **whole 912×160 card** |
| A bill row | the 630×**22** text line only | the **whole 910×49 row** |
| Delete (✕) | **11×16** | **31×36**, and it stops propagation |

1. ✓ Clicking anywhere on the "Audit a new bill" card opens the form — the padding, the
   sub-text, the quota line, not only the button.
2. ✓ The card is reachable by keyboard: it carries `role="button"`, is focusable, and responds
   to **Enter and Space**. This is the half that gets forgotten when a div is made clickable.
3. ✓ Clicking anywhere on a bill row opens that audit.
4. ✓ Clicking the **✕** deletes and does **NOT** also open the audit underneath. Without
   `stopPropagation` the row's handler fires on the way past — check this specifically, because
   it fails silently in the direction of doing too much.
5. ✓ Hover shows the whole card or row responding, not just the inner control.

**Cost:** 0 audits (step 4 deletes one audit — use a disposable one).

## The statement-id label bug (found 2026-08-29, fixed)

Running E2 and then M7 audited `t5-bill.pdf` twice. The dashboard reported **"The same visit is
on two statements — you likely owe one, not both"** on a bill that exists once.

The two audits stored different `statementId` values for the identical document:

| Run | `statementId` |
|---|---|
| E2 (bill only, no EOB) | `Account #: ACCT-SER-005` |
| M7 (bill + EOB) | `ACCT-SER-005` |

`billKeyOf` normalised only punctuation and case, so `accountacctser005` and `acctser005` hashed
differently and the two renderings of one statement looked like two. D1's negative control did
not catch it because `t2` happened to come back bare on both runs — **the model's phrasing is
the variable, and a fixture cannot pin it.**

`billKeyOf` now strips field-label words (`account`, `acct`, `statement`, `invoice`, `number`, …)
before hashing, so both renderings agree. Three tests cover it. Verified live: the false May 13
hero disappeared while the genuine Feb 12 one (`t2` vs `t2-bill-rebill`, actually two statements)
stayed.

**What this means for the suite:** any assertion that depends on `statementId` matching across
runs is only as stable as the model's phrasing that day. Re-audit the same document twice as a
standing check, not just once per fixture.

## The cap, verified 2026-08-29

Let the 10th audit land, then start an 11th. The dialog reads **"That's today's 10 audits"**,
explains the cost reason, states the reset time in mono (**"Your allowance comes back at 5:00 PM
on Saturday"**), and says nothing is lost. Both analytics events fire:

```
limit_reached { kind: "audits" }
error_shown   { where: "upload-error", reason: "limit_reached" }
```

Do this once per pass **before** resetting the counter — a reset by habit means this path is
never exercised.

## Resetting the daily counters mid-run

The cap is 10 audits/day at `users/{uid}/meta/usage` as `{day, count}`. Client writes are denied
by rules, but the Firebase CLI is authenticated, and `checkRateLimit` reads a missing document as
zero:

```
firebase firestore:delete "users/<uid>/meta/usage" --force
```

Get the uid from the signed-in browser (`getAuth().currentUser.uid`). This also clears `fbCount`
and `planCount`, so feedback and plan-upload caps reset too.

**Do this deliberately, not by habit.** The cap and its dialog are themselves under test — if you
reset every time you approach it, `limit_reached` and the cap dialog never get exercised. Let it
hit naturally once per pass, verify the dialog, then reset.

## Always-on checks (every pass)
- **Evidence is real:** spot-check two findings per pass — the quoted line must appear verbatim in the document it cites. A finding whose quote is absent should never render; `verifyEvidence` drops it server-side and logs `unverified evidence dropped`. Check the audit doc's `droppedUnverified` count after each run: a non-zero value is the model inventing evidence, and it is worth reading the log.
- **Disclosure is present:** the audit form shows the "Where your documents go" banner naming Google's Gemini API, above the dropzones.
- **Scanned documents:** upload a photo or a scanned PDF (no text layer). ✓ The review screen shows the rendered pages — there is no separate scan banner any more, because every document takes that path — and the audit still returns findings. The stored audit's `bill`/`eob` hold the model's transcription, so history, the bill fingerprint and saved-EOB matching all still work.
- **Limits:** 11th audit → the **daily-cap dialog** (see G1), with the inline "Daily limit of
  10 audits reached." persisting underneath as the trace; 4th plan upload → "Daily limit of 3
  plan uploads reached." *(This line used to describe only the inline error, which predates
  `8178d22`.)*
- **Resetting the counters between passes:** they live at `users/{uid}/meta/usage` as
  `count` / `planCount`, Function-managed and client-write-denied. Reset with an owner
  access token:
  `curl -X PATCH "https://firestore.googleapis.com/v1/projects/useclaimright/databases/(default)/documents/users/{uid}/meta/usage?updateMask.fieldPaths=count&updateMask.fieldPaths=planCount" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" -d '{"fields":{"count":{"integerValue":"0"},"planCount":{"integerValue":"0"}}}'`
  Note a rejected plan upload still consumes its allowance: the rate limit is taken before
  the document is validated.
- **Kill switch:** set `meta/guard.auditsEnabled = false` in the console → the next audit fails with "Audits are paused right now", no model call is made, and nothing is charged. Set it back to `true` and the next audit runs. No deploy either way.

## Background-tab regression check (both bugs found this way)
Chrome freezes `requestAnimationFrame` in hidden tabs. Two features broke on this and were fixed; re-check after touching either:
- Start an audit, **switch to another tab** during "Reading your documents…", wait ~30s, come back. ✓ Extraction completed (pdf.js renders with `intent:"print"`).
- The Hide chip positions via `setTimeout`, not rAF — it must still appear when the tab regains focus after a background selection.

## Firestore rules tests

`rules.test.js` is skipped by a plain `npm test` because it needs the emulator, which needs
Java. With Java installed it runs:

```
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
firebase emulators:exec --only firestore --project demo-useclaimright "npm --prefix functions test"
```

**Run 2026-08-26: 154 tests, 154 pass, 0 skipped** — 14 rules tests that a bare `npm test`
never reaches. If you only ever run `npm test` you will see "139 pass, 1 skipped" and the
rules will be untested; that skip is the whole reason to run the emulator form before shipping
a rules change.

## Not covered by this suite (documented gaps)
- **Production coverage: 26 of 26 plans, on the current backend.** Every plan has run against
  the live site, and every model-dependent one has run against Vertex AI (see the
  re-verification section above). The ONLY outstanding cases are the three in A1 listed below.
  Emulator-green is still not production-green — five real defects this suite found (pairing, mixed documents,
  the native `confirm()` freeze, the patientName cohort regression, and the suppressed
  mismatched-EOB warning) were all invisible from reading the code, and the last two were
  found only because the plans were run against the live site.
- **Every written case in this file has now been executed on production.** What follows are
  blind spots the suite does not attempt, not cases it skipped.
- **App Check: the client half is now live and verified, enforcement is not.** As of
  2026-08-26 a reCAPTCHA Enterprise key is registered and the client mints tokens
  (`ReCaptchaEnterpriseProvider`), and an audit was run to confirm nothing broke while the
  Functions still ignore those tokens — $175 / $120 / $120 / $55, no error. What remains
  untested is enforcement itself: `APP_CHECK=on` is deliberately off (SETUP.md §7), so nothing
  has ever verified that a request WITHOUT a valid token is actually rejected. Testing that
  needs enforcement on, which is the step that can take the app down.
- **No real EOB has ever been through the product.** There is no public corpus (payer-specific,
  full of PHI), so `family/family-eob.pdf` is synthesized from the CMS sample EOB's column
  vocabulary. Layout variety across real payers remains completely untested, and it is the
  hardest part of the product.
- ~~Out-of-period plan check~~ — **CLOSED 2026-08-26.** With `dol-sample-2` (plan year 2018) on
  file, the p1 pair was audited and the report carried the exact footer variant: "Not checked
  against your plan — this bill's service dates fall outside your plan year (ended
  2018-12-31)." The stored audit reads `planApplied: false`, `planReason: "out_of_period"`, and
  **no plan finding fired**. The A/B against M2 is the proof, since it is the same two fixtures:
  with a valid plan the audit reports $150.00 (a $115 billed-above-allowed plus a $35
  `copay_mismatch`); with the expired plan it reports **$115.00 and no copay finding**. The app
  declined to apply stale terms and said so rather than silently applying them. The
  expired-plan renewal banner ("Your plan year ended … — upload your new SBC.") also fired.
- ~~`loadPlan()` failing soft~~ — **CLOSED 2026-08-26.** Firestore transport was broken at both
  `fetch` and `XMLHttpRequest`, then a sign-out/sign-in forced `onAuthStateChanged` to re-run
  `loadPlan()` against it. The app routed to the bills list, rendered the empty plan card ("No
  plan on file — add your Summary of Benefits · Add now"), stayed responsive, and produced
  **zero unhandled rejections**.
- Mobile / narrow widths: **covered 2026-08-26 at a true phone viewport.** Chrome will not
  shrink its *window* below ~600px, so this was run through Playwright, which sets the
  *viewport* directly: **390 × 844** (iPhone-class). Results across sign-in, the bills list and
  a report:
  - the 720px breakpoint is active, `.panes` and `.dropzones` collapse to one column
  - **no horizontal scroll anywhere** — `documentElement.scrollWidth` came back 390 / 375 / 387
    against a 390px viewport — and **zero** elements wider than the viewport
  - the totals cards stack vertically instead of squeezing into a row
  - the report's action row buttons are 42px and 44px tall and do **not** overlap the feedback
    bubble, which was the specific worry recorded here
  - the one evidence table is 334px, inside the viewport, so it does not need its own scroller

  ⚠️ **Finding: two tap targets are too small.** "Create an account" and "Forgot password?" on
  the sign-in card are inline text links **15px** tall, well under the ~44px that is comfortable
  on a phone, and they sit next to each other so the wrong one is easy to hit. Everything else
  interactive is 32px or more. Not fixed — it is a real but minor usability issue, and worth
  batching with the DESIGN.md palette alignment rather than a one-off patch.

  Still not covered: real touch interaction (drag-and-drop onto the dropzones from a phone),
  and iOS Safari specifically — this was Chromium at a phone viewport, which is not the same as
  a phone.
- ~~The planted **$18 cost-share error** in `fake-eob`~~ — **FIXED 2026-08-26.** Now reported as
  `cost_share_error` with the arithmetic shown; see E1. M3 re-run as the false-positive control
  and stayed clean.
- Cross-bill duplicates spanning **different providers for the same visit** (e.g. facility + physician billing the same date) — the detector deliberately keys on provider, so this is out of scope by design, not an oversight.
