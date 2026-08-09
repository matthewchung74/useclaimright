# Manual Test Plans

Each plan states the **use case** it verifies, the exact **data** (fixture files) to use, numbered **steps** to execute, and the **expected result** at each checkpoint (✓). All fixtures live in `test-fixtures/` (regenerate HTML with `node test-fixtures/gen-series.mjs`; PDFs are rendered from the HTML via the browse CLI). Answer key for scripted checks: `test-fixtures/series-expected.json`. Pairings reference: `test-fixtures/README.md`.

**Setup for every session:** open https://useclaimright.web.app/app, hard-refresh (Cmd+Shift+R), sign in.
**Budget:** 10 audits/day and 3 plan (SBC) uploads/day per account. The full suite ≈ 9 audits + 1 plan upload.
**Automated tests first:** `cd functions && npm test` (55 assertions incl. plan logic). Rules tests need the emulator + Java: `firebase emulators:exec --only firestore "npm --prefix functions test"`.

---

## Plan 1 — Planted billing errors
**Use case:** the audit catches a duplicate charge and an EOB math error, with quoted evidence.
**Data:** `test-fixtures/fake-bill.pdf`, `test-fixtures/fake-eob.pdf`

1. On the upload screen, drag `fake-eob.pdf` onto the **EOB** dropzone.
   ✓ A row "✓ fake-eob.pdf ✕" appears under the EOB zone.
2. Drag `fake-bill.pdf` onto the **Itemized bill** dropzone.
   ✓ A row appears under the bill zone; button still reads "Prepare audit →".
3. Click **Prepare audit →**.
   ✓ Processing screen ("Reading your documents…", privacy model download on first run), then the review screen.
4. On the review screen, check both tabs (Bill / EOB).
   ✓ Personal details (Jane Q. Testpatient, DOB 03/14/1985, MRN TESTMRN-424242, AHX-55512345) appear as green chips like `NAME_1` in the right pane; the left pane shows the original.
5. Click **Looks right — analyze**.
   ✓ Report appears with: a **duplicate charge** finding (80053 metabolic panel, $145.50 billed twice — occurrence table shows count 2) and a **cost-share error** (~$18: EOB states $186.35, line items sum $168.35). Both amounts feed "Worth disputing".
6. Click **Generate dispute email**.
   ✓ Draft quotes the bill and EOB lines for each finding.

**Cost:** 1 audit.

## Plan 2 — File intake: accumulation, roles, removal
**Use case:** files added one at a time accumulate into one list; filename decides bill vs EOB; ✕ removes; no audit is started.
**Data:** `test-fixtures/series/` → `t1-bill.html`, `t2-bill.html`, `t3-bill.html`, `t-eob.html`

1. Drag `t1-bill.html` onto the bill zone. ✓ One row under the bill zone.
2. Drag `t2-bill.html` onto the bill zone. ✓ Second row appears (nothing replaced); summary line appears: "2 audits…"; button now "Start 2 audits →".
3. Drag `t3-bill.html` onto the **EOB** zone deliberately. ✓ It still lands under the **bill** list (filename wins over zone).
4. Drag `t-eob.html` onto the **bill** zone deliberately. ✓ It lands under the **EOB** list.
   ✓ Summary reads "**3 audits: 3 bill+EOB pairs.**"
5. Drag `t1-bill.html` in again. ✓ No duplicate row appears.
6. Click ✕ on the t2 row. ✓ Row disappears, summary drops to 2 audits. Re-add it. ✓ Back to 3.
7. Stop here — do not click Start.

**Cost:** 0 audits.

## Plan 3 — Consolidated EOB batch with review-all
**Use case:** one EOB covers many claims across months; every document is redacted and reviewed once; audits run without pausing.
**Data:** the four files staged in Plan 2. Applies deductible $120/claim (answer key: `series-expected.json`).

1. From Plan 2's staged state, click **Start 3 audits →**.
   ✓ Processing shows per-document redaction ("Hiding personal info in t2-bill.html (3 of 4)…").
2. On the review screen:
   ✓ Four tabs (t1-bill, t2-bill, t3-bill, t-eob) + a bold line "Reviewing **<name>** — document N of 4" that changes as you click each tab.
3. Leave **save this EOB** checked. Click **Looks right — analyze** ONCE.
   ✓ No further review screens: status advances "Analyzing audit 1 of 3… 2 of 3… 3 of 3".
4. Final report loads.
   ✓ Label: "Batch complete — all 3 audits are saved under 'Your past audits'." Past audits list shows 3 entries.
5. Open each past audit.
   ✓ Each matched its claim line in the consolidated EOB (no `not_in_eob` for t1–t3); deductible card shows $360 of $1,500.

**Cost:** 3 audits.

## Plan 4 — EOB library: dedupe, reuse, negative case
**Use case:** a saved consolidated EOB is stored once, pre-selected for later bills; a claim missing from it is flagged.
**Data:** saved EOB from Plan 3; `test-fixtures/series/t4-bill.pdf`

1. On the upload screen, expand **My saved EOBs**.
   ✓ Exactly ONE entry ("Testville Behavioral Health Associates · 2026-01-15") even though 3 audits shared it.
2. Drag `t4-bill.pdf` onto the bill zone. Do NOT add an EOB.
   ✓ The saved-EOB dropdown is pre-selected: "✓ using saved: Testville…".
3. Click **Prepare audit →**, review (t4-bill only; EOB tab shows the saved-EOB notice), click **Looks right — analyze**.
   ✓ Report shows **"On the bill, missing from the EOB"** (`not_in_eob`) for the April 90837 visit — the consolidated EOB only covers Jan–Mar. "EOB allowed $0.00", full $175 worth disputing.

**Cost:** 1 audit.

## Plan 5 — Usage tracker progression
**Use case:** visit counting toward a limit, amber/red remark-driven warnings, deductible accumulation.
**Data:** `t4-bill.pdf`+`t4-eob.pdf`, `t5-bill.pdf`+`t5-eob.pdf`, `t6-bill.pdf`+`t6-eob.pdf`. Needs a psychotherapy tracker — auto-created by Plan 7, or create manually: Coverage usage → **Track a limit** → preset Psychotherapy, limit 6, January.

1. Audit `t4-bill.pdf` + `t4-eob.pdf` (drag both, Prepare, review, analyze).
   ✓ Tracker card counts the visit; report shows "visit N of 6" line; deductible $480.
2. Audit `t5-bill.pdf` + `t5-eob.pdf`.
   ✓ t5's EOB remark "5 of 6 visits used" → tracker turns **amber** ("One covered visit left this plan year"); if no tracker existed, the 💡 suggestion banner offers "Track it".
3. Audit `t6-bill.pdf` + `t6-eob.pdf`.
   ✓ Benefit maximum reached → tracker **red** ("Limit reached…"); deductible card $720 of $1,500.

**Cost:** 3 audits. (Counts assume the t1–t3 visits from Plan 3 are in history.)

## Plan 6 — PT control: no false positives, no plan on file
**Use case:** a clean claim produces no findings; the report is honest that no plan check ran.
**Data:** `test-fixtures/series/p1-bill.pdf` + `p1-eob.pdf`. Run BEFORE uploading the SBC (or delete the plan first).

1. Audit the p1 pair.
   ✓ "No discrepancies found." (or empty findings); totals consistent ($95 responsibility).
   ✓ Report footer (gray, above the disclaimer): "**Not checked against your plan** — add your Summary of Benefits under Coverage usage to enable plan checks."

**Cost:** 1 audit.

---

# SBC / plan feature

## Plan 7 — SBC upload → plan card + auto-configuration
**Use case:** uploading a Summary of Benefits auto-configures deductible target, visit trackers, and the plan card.
**Data:** `test-fixtures/fake-sbc.pdf` (Acme Silver PPO)

1. Scroll to **Coverage usage**. ✓ The "Your plan" card shows the empty state: "Add your Summary of Benefits — we'll set up your deductible and visit limits automatically", its own small dropzone, and a "What's an SBC?" explainer.
2. Drag `fake-sbc.pdf` onto that dropzone (NOT the bill/EOB zones).
   ✓ Processing → review screen with ONE document and the note that plan documents carry little personal info. Member name/ID chipped.
3. Click **Looks right — analyze**.
   ✓ "Reading your plan's terms…", then back to the upload screen, scrolled to the plan card.
4. Inspect the plan card.
   ✓ Header "Acme Silver PPO" + mono period `2026-01-01 → 2026-12-31`; grid: Deductible **$1,500**, Out-of-pocket max **$6,000**, Outpatient mental health **6/yr**, Rehabilitation **20/yr**.
5. Inspect trackers. ✓ Two new trackers, each tagged "**from your SBC — check the codes**"; opening a tracker's details clears its tag.
6. Inspect the deductible card. ✓ "$0 of $1,500" with "Target from your plan (SBC)" (until an EOB states progress).
7. Click **View full plan**. ✓ The redacted SBC text appears in a card below.

**Cost:** 1 plan upload.

## Plan 8 — SBC freshness: duplicate re-upload
**Use case:** re-uploading the identical SBC never re-extracts or duplicates.
**Data:** the same `fake-sbc.pdf`.

1. Upload `fake-sbc.pdf` again via Replace (or the dropzone), confirm the review.
   ✓ Error banner: "**This plan is already on file.**" — instantly, with no "Reading your plan's terms…" step (no server call, no plan-upload consumed).

**Cost:** 0.

## Plan 9 — Plan cross-check: planted copay mismatch
**Use case:** the audit compares bill/EOB against the plan's printed terms and quotes both sides with the highlighted delta.
**Data:** `p1-bill.pdf` + `p1-eob.pdf`, with the SBC from Plan 7 on file. Planted contradiction: SBC says rehab = "$60 copay/visit, deductible does not apply"; p1-eob charges $95.

1. Audit the p1 pair again.
   ✓ Finding under "**Copay doesn't match your plan**", medium confidence, structured as:
   — mono quote `SBC "Rehabilitation services … $60 copay/visit, deductible does not apply"`
   — mono quote of the bill/EOB line
   — sentence ending in a **yellow-highlighted** "$35.00 you may not owe" (approximate; delta = $95 − $60).
   ✓ Delta included in "Worth disputing". ✓ NO "not checked" footer.
2. Click **Generate dispute email**. ✓ The draft includes `My plan (SBC) states: "…$60 copay…"`.

**Cost:** 1 audit.

## Plan 10 — Plan cross-check: no false positives + precedence
**Use case:** consistent plan terms produce no plan findings; EOB progress + SBC limit combine on the deductible card.
**Data:** `t1-bill.pdf` + `t1-eob.pdf` with the SBC on file. (SBC mental-health row "$0 coinsurance after deductible" agrees with the EOB applying $120 to deductible.)

1. Audit the t1 pair.
   ✓ NO plan-mismatch findings (regular audit results only).
   ✓ Mental-health tracker counts the visit.
   ✓ Deductible card: **$120 of $1,500** — progress "as stated on your most recent EOB", limit from the plan.

**Cost:** 1 audit.

## Plan 11 — Plan not-applicable paths
**Use case:** the report says so when the plan check can't run.
**Data:** any bill whose service dates fall outside 2026 (edit a fixture's dates and regenerate, or use any old document), SBC on file.

1. Audit it.
   ✓ Audit completes normally; footer: "Not checked against your plan — this bill's service dates fall outside your plan year (ended 2026-12-31)." No plan findings.
2. (Covered by Plan 6 for the no-plan variant.)

**Cost:** 1 audit.

---

## Always-on checks (verify during every pass)
- **PHI canary:** every review screen chips Jane Q. Testpatient / 03/14/1985 / TESTMRN-424242 / AHX-55512345. Selecting missed text + **Hide selection** redacts it across all open documents.
- **Originals destroyed:** after confirming any review, originals are gone (the report and history never show unredacted values).
- **Rate limits:** 11th audit → "Daily limit of 10 audits reached."; 4th plan upload → "Daily limit of 3 plan uploads reached."
