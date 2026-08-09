# Manual Test Plans

Every plan names the use case it tests and the exact fixture data to use. All fixtures live in `test-fixtures/` (regenerate HTML with `node test-fixtures/gen-series.mjs`; PDFs are rendered from the HTML via the browse CLI). The answer key for scripted checks is `test-fixtures/series-expected.json`; fixture pairings are documented in `test-fixtures/README.md`.

**Budget:** the server allows **10 audits/day** and **3 plan (SBC) uploads/day** per account. Full suite below ≈ 9 audits + 2 plan uploads — run it on a fresh day or split across days.

**Automated tests** (run before any manual pass): `cd functions && npm test` — pure logic, schema, pairing, usage math. Rules tests need the emulator: `firebase emulators:exec --only firestore "npm --prefix functions test"` (requires Java).

---

## 1. Planted billing errors (core audit value)
**Use case:** the audit catches a duplicate charge and an EOB math error, with quoted evidence.
**Data:** `fake-bill.pdf` + `fake-eob.pdf` (ED visit, claim CLM-2026-0612-777).
**Steps:** single audit, review redactions, analyze.
**Expected:** duplicate 80053 metabolic panel ($145.50 ×2) flagged; $18 patient-responsibility math error ($186.35 stated vs $168.35 line sum); both feed "Worth disputing"; occurrence table shows 80053 count 2.
**Costs:** 1 audit.

## 2. File intake — accumulation, roles, removal
**Use case:** files added one at a time (drag or click, either zone) accumulate into one list; filename decides bill vs EOB, zone decides for ambiguous names; ✕ removes.
**Data:** `series/t1-bill.html`, `series/t2-bill.html`, `series/t3-bill.html`, `series/t-eob.html` — added one at a time, any order, any zone.
**Steps:** add all four individually; re-add `t1-bill` (dedupe check); remove one with ✕ and re-add.
**Expected:** rows appear under the correct zones ("✓ name ✕"); `t-eob` lands under EOB even if dropped on the bill zone; no duplicate row on re-add; summary reads "3 audits: 3 bill+EOB pairs"; button label switches to "Start 3 audits →".
**Costs:** 0 audits (don't start).

## 3. Consolidated EOB batch with review-all
**Use case:** one EOB covering many claims across months; all documents redacted and reviewed once, then audits run uninterrupted.
**Data:** `t1-bill` + `t2-bill` + `t3-bill` + `t-eob` (covers Jan/Feb/Mar claims; deductible $360 of $1,500). Leave "save this EOB" checked.
**Steps:** start the batch; on the review screen click every document tab; confirm once.
**Expected:** review shows one tab per unique document (3 bills + 1 EOB) with "Reviewing <name> — document N of M"; audits run with no pauses ("Analyzing audit 2 of 3…"); final report shows "Batch complete — all 3 audits saved"; each audit matches its claim lines; results match `series-expected.json`.
**Costs:** 3 audits.

## 4. EOB library — save, dedupe, reuse, delete
**Use case:** a saved consolidated EOB is stored once, pre-selected for later bills, and never duplicated.
**Data:** the saved `t-eob` from plan 3; `series/t4-bill.pdf`.
**Steps:** after plan 3, check the library (one entry: "Testville Behavioral Health Associates · 2026-01-15"); audit `t4-bill` alone with the saved EOB pre-selected.
**Expected:** exactly one library entry despite 3 audits sharing it; `t4-bill` audit auto-uses the saved EOB and returns **not_in_eob** (t4's April claim is deliberately absent from the consolidated EOB — this is the negative test); ✕ deletes a library entry after confirm.
**Costs:** 1 audit.

## 5. Usage tracker progression (plan limits)
**Use case:** visit counting against a limit, amber/red warnings from payer remarks, deductible accumulation.
**Data:** `t4-bill`+`t4-eob`, `t5-bill`+`t5-eob`, `t6-bill`+`t6-eob` (individual pairs). Requires a psychotherapy tracker (create via "Track a limit" preset, 6/yr — or let the SBC auto-create it, plan 8).
**Steps:** audit the three pairs in order.
**Expected:** t5's EOB remark "5 of 6 visits used" → tracker amber + suggestion banner if untracked; t6 → benefit maximum reached, tracker red with "limit reached" note; deductible card reaches $720 of $1,500 "as stated on your most recent EOB"; report shows "visit N of 6" line.
**Costs:** 3 audits.

## 6. PT control (no false positives)
**Use case:** a clean, correctly-adjudicated claim produces no findings (pre-SBC).
**Data:** `series/p1-bill.pdf` + `series/p1-eob.pdf` (97110 PT, 2026-03-20, allowed $95, member responsibility $95). Run WITHOUT a plan on file (or before plan 8).
**Expected:** no findings; totals consistent; with no SBC on file the report footer shows "Not checked against your plan — add your Summary of Benefits…".
**Costs:** 1 audit.

---

# SBC / plan feature (available once feat/sbc-ingestion is deployed)

## 7. SBC upload → plan card + auto-configuration
**Use case:** uploading a Summary of Benefits auto-configures the deductible target and visit-limit trackers, and renders the plan card.
**Data:** `test-fixtures/fake-sbc.pdf` (Acme Silver PPO: deductible $1,500/$3,000, OOP $6,000/$12,000, period 2026-01-01→12-31, mental health 6/yr, rehab 20/yr with planted $60 copay row).
**Steps:** Coverage usage → "Your plan" card → upload; review the single-document redaction screen; confirm.
**Expected:** card shows plan name, mono period + figures grid; two trackers appear tagged "from your SBC — check the codes"; deductible card shows "$0 of $1,500 · Target from your plan (SBC)" (until an EOB states progress); "View full plan" shows the redacted text.
**Costs:** 1 plan upload.

## 8. SBC freshness — duplicate, older, expired
**Use case:** re-uploads never silently clobber the plan.
**Data:** the same `fake-sbc.pdf` again.
**Steps:** upload the identical file again.
**Expected:** "This plan is already on file." with NO server call (plan-upload count unchanged). Uploading an SBC with an older coverage period than the one on file → explicit "Replace anyway?" confirm. After the plan year ends, the card shows the amber renewal nudge.
**Costs:** 0 (duplicate is caught client-side).

## 9. Plan cross-check — planted copay mismatch
**Use case:** the audit compares the bill/EOB against the plan's printed terms and quotes both sides.
**Data:** `p1-bill.pdf` + `p1-eob.pdf` with `fake-sbc` on file. Planted contradiction: SBC rehab row says "$60 copay/visit, deductible does not apply"; p1-eob charges $95 member responsibility.
**Expected:** a **"Copay doesn't match your plan"** finding (medium confidence): SBC row quoted verbatim, bill/EOB line quoted, ~$35 delta carrying the yellow highlighter mark; delta feeds "Worth disputing"; no "not checked" footer.
**Costs:** 1 audit.

## 10. Plan cross-check — no false positives
**Use case:** consistent plan terms produce no plan findings.
**Data:** `t1-bill.pdf` + `t1-eob.pdf` with `fake-sbc` on file (SBC mental-health row "$0 coinsurance after deductible" matches the EOB applying $120 to deductible).
**Expected:** no plan-mismatch findings; the mental-health tracker counts the visit; deductible card switches to EOB-stated progress ($120 of $1,500) with the SBC still owning the limit.
**Costs:** 1 audit.

## 11. Plan not-applicable paths
**Use case:** the report is honest when the plan check can't run.
**Data:** any bill with service dates outside 2026 (edit a fixture date or use an old document) with `fake-sbc` on file; or any audit with no plan on file.
**Expected:** audit runs normally; footer line "Not checked against your plan — this bill's service dates fall outside your plan year (ended 2026-12-31)." (or the add-your-SBC variant); no plan findings present.
**Costs:** 1 audit.

---

## Always-on checks (every manual pass)
- **PHI canary:** the redaction review must chip Jane Q. Testpatient, DOB 03/14/1985, MRN TESTMRN-424242, Member ID AHX-55512345 in every document; "Hide selection" applies across all open documents.
- **Privacy gate:** originals are destroyed at confirm — the processing screen note and the report never show unredacted values.
- **Rate limits:** 11th audit of the day → "Daily limit of 10 audits reached"; 4th plan upload → "Daily limit of 3 plan uploads reached."
