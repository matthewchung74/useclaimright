# Test Plans — SBC-first

The main case assumes the user has their **Summary of Benefits (SBC)** on file: setup once, then every audit is checked against the plan. Exception cases cover missing documents (no SBC, no EOB, wrong document). Each plan names its use case, exact fixture data, numbered steps, and ✓ checkpoints.

Fixtures: `test-fixtures/` (regenerate HTML: `node test-fixtures/gen-series.mjs` and `node test-fixtures/gen-family.mjs`; PDFs render via the browse CLI). Answer key: `test-fixtures/series-expected.json`. Pairings: `test-fixtures/README.md`.

Three fixture sets, and they are not interchangeable:
- **synthetic** (`fake-*.pdf`, `series/`) — planted errors with known answers. Most plans use these.
- **real** (`real-sbc/`, `real-eob/`) — genuine CMS and DOL documents. The only fixtures we did not write ourselves, and therefore the only ones that can tell us extraction works on something other than our own assumptions. Used by **P1**.
- **family** (`family/`) — a consolidated household EOB and three bills. Reproduces two defects fixed on 2026-08-23/24. Used by **FAM1–FAM3**.

**Session setup:** open https://useclaimright.web.app/app, hard-refresh, sign in. Three ways in — Google, email + password, or an email link — see **A1**. A fresh account starts empty with full daily limits (**10 audits, 3 plan uploads**).

**Budget — the full suite does NOT fit in one day.** Core plans (E1, M1–M6, D1, E2, E4–E7) cost **10 audits + 3 plan uploads**, exactly the daily ceiling, leaving no room for the rate-limit check. Optional **M7** adds 3 more. Run it as:

- **Day 1 (core):** E1 → **E1b** → M1 → M2 → M3 → M4 → M5 → M6 → D1, then the zero-cost plans (E3, E5*, R1, F1, R2). *E5 needs a plan upload.
  **E1b is not optional and not movable:** it costs no audits, but it starts from E1's report and ends by clearing the files M1 needs gone, so it only works in that slot.
- **Day 2 (edges):** M7, E2, E4, E6, E7, and the rate-limit check in Always-on.
- **Day 3 (auth, family, scans, real documents):** A1 (0 audits) → FAM1 (2 audits) → FAM2 (0, reads FAM1's) → FAM3 (0) → S1 (1 audit) → P1 (3 plan uploads) → G1 (0). Total **3 audits + 3 plan uploads**, so it fits comfortably and can be folded into Day 2 if Day 2 ran light.
- Or use **☰ → Reset account** between passes: it clears data and returns you to onboarding, but **daily counters intentionally survive**, so it does not buy more audits.

**Automated tests first:** `cd functions && npm test`. Rules tests need the emulator + Java: `firebase emulators:exec --only firestore "npm --prefix functions test"`.

**Reading the totals tables:** every plan that spends an audit states its four totals cards in the same table — Billed, EOB allowed, Your responsibility, Worth disputing — with the arithmetic behind "Worth disputing" spelled out in the last column, followed by the findings that produce it. Amounts are model-extracted: treat them as ± a few dollars, but the **relationships must hold exactly** — Worth disputing equals its listed findings summed (nothing else folded in), and EOB allowed is $0.00 whenever there is no EOB.

**Moving between plans:**
- **Bills & coverage is home** — every sign-in lands there, and so does every batch. The audit form is reached from its "**Audit a new bill**" card; "← Back to bills" on the form and on any report goes back.
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
2. Click **Start an audit →**. ✓ The audit form appears with a "← Back to bills" link above the heading. **Step 1 is "Add your bill"** — the document the user actually has — and **step 2 is "Add the letter from your insurance, if you have it"**, with the "What's an EOB…" explainer under it. *(Reordered 2026-08-16: the EOB used to be step 1, putting eight elements and an acronym in front of the bill.)* Drag `fake-bill.pdf` onto the bill zone, `fake-eob.pdf` onto the insurance-letter zone. ✓ One "✓ file ✕" row under each zone.
3. Click **Prepare audit →**. ✓ Processing is quick — the PDF's text layer is read directly, no model download.
4. Review both tabs. ✓ Left pane shows the rendered pages, right pane the extracted text under "What we'll analyze". Text matches the document; no placeholder chips anywhere (redaction was removed 2026-08-23).
5. Click **Looks right — analyze**.
   ✓ **The four totals cards** (observed 2026-08-10):

   | Card | Expected | Why |
   |---|---|---|
   | Billed | **$2,115.00** | sum of the bill's line items |
   | EOB allowed | **$841.75** | the plan's allowed amount |
   | Your responsibility | **$186.35** | what the EOB says you owe |
   | Worth disputing | **$804.15** | $145.50 duplicate + $658.65 billed-above-allowed |

   ✓ **Duplicate charge** $145.50 — 80053 metabolic panel billed twice (occurrence table count 2).
   ✓ **Billed above EOB allowed** $658.65 — the bill demands ~$845 against $186.35 responsibility.
   ✓ **Charity care eligible** $186.35 — nonprofit-hospital financial assistance flag. Note it is deliberately **not** added into "Worth disputing": it's an avenue to pursue, not an overcharge, and adding it would double-count the responsibility figure.
   ✓ Sanity check: "Worth disputing" equals the duplicate plus the billed-above-allowed exactly. If it ever equals all three findings summed, that's a double-count bug.
   ⚠️ *Known gap:* the planted **$18 cost-share error** (EOB states $186.35; its own lines sum to $168.35) is **not** reported as `cost_share_error` — the discrepancy gets folded into the billed-above-allowed finding. Treat a `cost_share_error` here as a bonus, not a requirement.
   ✓ The found-money card is labelled just "**Worth disputing**" — the old sentence-long label ("money you may not owe; hold off paying this part") is gone from every report.
   ✓ Footer: "**Not checked against your plan** — add your Summary of Benefits under 'Your coverage' on the bills page to enable plan checks."
done
**Cost:** 1 audit.

**Verified on production 2026-08-25**, from a freshly reset account: every figure matched the
answer key exactly — billed $2,115.00, EOB allowed $841.75, responsibility $186.35, worth
disputing **$804.15**, with `duplicate_charge` $145.50, `billed_vs_allowed_mismatch` $658.65
and `charity_care_eligible` $186.35 at medium confidence. The sanity check holds:
145.50 + 658.65 = 804.15 exactly, charity care excluded. `droppedUnverified` 0,
`ocrConfidence` 100, scan caveat correctly hidden, plan footer present. Step 1 also
confirmed: onboarding first, audit card above the empty state, dashed "No plan on file"
reminder under Your coverage.

## E1b — Intake and account-menu details (no audits)
**Use case:** the small copy and affordance fixes a full audit pass wouldn't catch.
**Getting here:** on E1's report, click **← Back to bills**, then **Audit a new bill**. (**New audit** on the report goes to the same form directly; either route clears E1's files.)

1. On the audit page: ✓ both dropzones read "**Drop one or more files**, or click to choose"; the SBC dropzone reads "Drop it here" — one plan only.
2. Drop two bills one at a time. ✓ They accumulate as rows, nothing is replaced, the button becomes "Start 2 audits →", and the summary reads "**2 audits**: 0 bill+EOB pairs, 2 with no EOB" (no saved EOB exists yet on a fresh account).
3. Open **☰**. ✓ Your full email wraps without breaking mid-word; **Sign out**; then **Reset account — erase all my data** below a divider, in red, with a red (not teal) hover.
4. ✓ The "What's an EOB, and where do I find it?" explainer sits with the **insurance-letter step (step 2)**, directly under that dropzone — not stranded after the bill section.
5. **Clean up before M1**: remove both staged bills with their **✕**. ✓ The rows disappear and the button returns to "Prepare audit →".

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
   ✓ Coverage usage: two trackers tagged "**from your SBC — check the codes**" (6/yr mental health, 20/yr rehab).
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

1. Add all three files (any order, any zone — filenames route them). ✓ Rows accumulate; summary "2 audits: 2 bill+EOB pairs"; button "Start 2 audits →".
2. Start. ✓ Per-document extraction progress, then ONE review screen with 3 tabs + "Reviewing <name> — document N of 3".
3. Confirm once. ✓ "Analyzing audit 1 of 2… 2 of 2" with no pauses, then the batch **lands on the Bills & coverage page — not on one audit's report**. (Before this change it showed whichever audit the queue ordered last, with no signal the other existed.)
   ✓ A **highlighter-ribboned "JUST AUDITED" block** sits above "Your bills": "JUST AUDITED · **2 bills** · **$110.00** worth disputing", then one row per audit — date · plain-English finding · amount. Each t-audit is $55 (bill demands $175, EOB responsibility $120), so the block's total is the real batch total; no screen shows $55 as if it were the answer for the whole batch.
   ✓ Clicking either row opens **that** audit's own report, and "← Back to bills" returns with the block still pinned. Both reports carry the t-series shape:

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

**Cost:** 2 audits.

## M5 — EOB library reuse + missing-claim detection
**Use case:** the saved consolidated EOB pre-selects for the next bill; a claim it doesn't cover is flagged.
**Data:** `series/t4-bill.pdf` alone (April visit — not in the consolidated EOB).

1. Expand "My saved EOBs". ✓ The consolidated EOB saved ONCE despite 2 audits sharing it.
2. Upload `t4-bill.pdf` only. ✓ Saved EOB pre-selected ("✓ using saved: …").
3. Prepare, review, analyze.
   ✓ On the review screen, the label above reads "Using saved EOB: … — **matched by provider and service date**" (or "most recent in your library" if no content match) — the auto-pick is explained, and an explicit dropdown choice is never overridden.
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

## M6 — Plan lifecycle: duplicate re-upload
**Use case:** re-uploading the same SBC never re-extracts or duplicates.
**Data:** the same `fake-sbc.pdf`, via the plan line's **Replace**.

1. Replace → pick `fake-sbc.pdf` → confirm the review.
   ✓ "**This plan is already on file.**" — immediate, no "Reading your plan's terms…" step, no plan-upload consumed; plan line unchanged.

**Cost:** 0.

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

**Cost:** 3 audits.

## D1 — Bills & coverage dashboard, incl. cross-bill duplicate
**Use case:** the cumulative view — what's worth disputing across all bills, what coverage is left, and the one finding no single audit can produce (the same visit billed on two statements).
**Data:** `series/t2-bill.pdf` + `t2-eob.pdf`, then `series/t2-bill-rebill.pdf` + `t2-eob.pdf` (a second statement for the same 2026-02-12 visit — same provider, same 90837, different statement date and account number), with `fake-sbc.pdf` on file.

1. Audit the t2 pair, then audit the re-bill pair. Each single audit ends on its own report — click **← Back to bills** to reach the dashboard. (The dashboard is also where you land on every sign-in: it is the home screen, and the audit form is reached from its "Audit a new bill" card.)
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

**Cost:** 1 audit.

## E3 — Remove the plan
**Use case:** deleting the plan reverts the app to the no-SBC state without touching trackers or history.
**Data:** none.

1. Click **Remove** on the plan line. ✓ Confirm dialog names the plan and says trackers stay.
2. Confirm. ✓ The dashed "No plan on file — add your Summary of Benefits · Add now" reminder returns under **Your coverage**; trackers remain (tags still cleared/uncleared as they were); deductible card falls back to EOB-stated values ("$120.00 of $1,500.00" from t-series EOBs, no "Target from your plan" line... EOB-only sourcing).

**Cost:** 0.

## E4 — Wrong document on the SBC dropzone
**Use case:** a non-SBC upload is rejected cleanly, storing nothing.
**Data:** `series/t6-bill.pdf` uploaded as an SBC.

1. Upload it to the SBC dropzone, confirm the review.
   ✓ Error: "**This doesn't look like a Summary of Benefits.**" — no plan stored, the empty-state card remains.
   (Note: this consumes a plan upload — the guard runs before extraction.)

**Cost:** 1 plan upload.

## E5 — Restore the plan (closes the loop)
1. Upload `fake-sbc.pdf` again via **Add now** under "Your coverage". ✓ Full M1 checkpoints repeat (plan line, trackers update in place — no duplicates, `source:"sbc"` trackers refreshed).

**Cost:** 1 plan upload (3/3 for the day after M1 + E4 + E5).

## E6 — Wrong EOB paired with a bill
**Use case:** pairing the wrong EOB must be called out, not silently reported as "you may not owe the whole bill".
**Data:** copies of two unrelated fixtures given matching stems so they pair by filename — e.g. `mixup-bill.pdf` (copy of `fake-bill.pdf`, ED visit 2026-06-12) + `mixup-eob.pdf` (copy of `series/p1-eob.pdf`, PT 2026-03-20).

1. Upload both, Prepare audit. ✓ They pair ("1 audit: 1 bill+EOB pair").
2. On the review screen, **before** analyzing:
   ✓ Banner: "⚠️ **This EOB may not cover this bill** (mixup-bill.pdf) — they share no service dates and no procedure codes…"
3. Repeat with a genuine pair (`p1-bill.pdf` + `p1-eob.pdf`). ✓ **No banner** — a real pair shares dates and codes.
4. Note: files with clearly different stems (`fake-bill.pdf` + `p1-eob.pdf`) never pair at all — the filename router keeps them separate and the audit reports "1 bill-only, 1 EOB has no matching bill".
5. Backstop (needs a real audit): if a mismatched pair is analyzed anyway and **every** finding comes back `not_in_eob`, the report shows "⚠️ Every line on this bill came back missing from the EOB…" above the totals.
   ✓ **Fixed 2026-08-16.** It originally failed here: the model returned `duplicate_charge` and `charity_care_eligible` alongside `not_in_eob`, and the old condition demanded *every* finding be `not_in_eob`. The report now also fires when the two documents share **no dates and no codes** — the same `documentsRelated()` evidence the step-2 banner uses — and the wording adapts: "**This EOB may not cover this bill.** They share no service dates and no procedure codes…".
   ✓ The discrimination that matters: this audit shows the warning, while **M5's genuine missing claim does not** (its bill and EOB do share a code). Verified live on both.
   ✓ **The four totals cards** — the failure signature the banner exists for:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | the ED bill's total (**~$2,115.00**) | the bill's line items |
   | EOB allowed | **$0.00** | the PT EOB adjudicated nothing on this bill |
   | Your responsibility | ≈ the **entire bill** | nothing allowed, so everything lands on you |
   | Worth disputing | ≈ the **entire bill** | every finding is `not_in_eob` |

   ⚠️ These are the same numbers as **M5**, where the missing claim was genuine. The totals cannot distinguish "your insurer never processed this" from "you paired the wrong two documents" — the banner in step 2 is the only thing that can, which is why it must fire *before* the audit is spent.

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

**Verified on production 2026-08-25:** delete-an-audit showed "Delete this audit?" / "The
audit and its findings are removed permanently. Your other audits are untouched." /
"Delete audit" in red, the renderer stayed responsive throughout, and confirming took the
dashboard from 5 bills to 4. The other five paths were not individually re-run.

**Cost:** 0 audits (deletes only).

## E7 — Reset account returns you to onboarding (destructive — run last)

**Verified on production 2026-08-25:** the confirmation is now the app's own dialog —
"Erase everything?" / "This deletes every audit, saved EOB, tracker and your plan. It cannot
be undone. Today's usage counters stay as they are." / red "Erase everything". After
confirming: 0 audits, 0 saved EOBs, 0 trackers, no plan, back on `onboarding`, and the usage
counter document survived rather than being deleted — which is the non-obvious part the
dialog now states up front.
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
4. ✓ Both exits work: "← Back to bills" returns to the list; "New audit" goes to the form, whose "← Back to bills" also returns.
5. ✓ From the list, "**Audit a new bill**" shows "EOB on file: …" when the library has one, and its "Start an audit →" opens the form with the previous run's files cleared.
6. **Pairing summary tells the truth about the EOB.** On the audit form, stage two bills with no EOB file, and confirm a saved EOB is selected in the dropdown.
   ✓ The summary reads "**2 audits**: 0 bill+EOB pairs, 2 **with your saved EOB**" — not "no matching EOB", which is what it used to say even though the run does attach the saved EOB to every bill.
   ✓ Tick "**I don't have an EOB**": the summary changes in place to "2 with **no** EOB". Untick it, re-pick the saved EOB: it changes back. The summary and the run must never disagree about which EOB is in play.
   ✓ Confirm on the review screen that the saved EOB is actually there — it appears as its own tab, labelled "saved: …".
7. **Clean up**: remove both staged bills with their **✕**.

**Cost:** 0 audits (back out of step 6 with **Start over** if you got as far as a review).

## F1 — Feedback widget
**Use case:** in-app feedback reaches the founder without leaving the app.
**Data:** none.

1. On the audit page (or a report), find the teal **chat bubble** bottom-right. ✓ It does NOT appear on the sign-in, onboarding, processing, or review screens.
2. Click it → card opens: "Send feedback", Bug/Idea/Other pills, textarea, Send.
3. Pick a category, type a note, Send.
   ✓ "Thanks — we read every note." and the card closes itself.
   ✓ The submission appears in the Firestore `feedback` collection (console or CLI) with uid, email, message, category, screen, and — when sent from a report — the auditId.

**Cost:** 0 audits (20 feedback/day limit).

# Auth

## A1 — Three ways in, and the failures a real person hits
**Use case:** password sign-in was added 2026-08-25 alongside Google and the email link.
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
4. **Email link** — "Email me a link instead" ✓ shows "Link sent — check your inbox on this
   device", and the link signs you in. The address must be typed first.

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
  yet. Use Google or an email link." Not a message blaming the member for a config problem.
- **Reset does not leak account existence:** "Forgot password?" with an address that has NO
  account ✓ shows the same "check your inbox" as one that does. Anything else turns the form
  into an account-existence oracle.
- **Enter submits** from both the email and the password field.
- **The button disables while in flight** — double-clicking must not fire two attempts.

**Cost:** 0 audits.

**Verified on production 2026-08-25:** cases 1, 3, 4, 5, 6, 7, 8a, 8b, 8c, 9, 10 and the
in-flight button disable all pass, with our copy in every case and never a raw Firebase
string. Case 5 corrected as above. **Not run:** Google sign-in, the email link, and the
provider-switched-off message (which needs the provider disabled in the Console).

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
3. **← Back to bills.**
   ✓ **NO duplicate hero. No `FOUND BY COMPARING YOUR BILLS TO EACH OTHER` ribbon.**
   ✓ The provider group reads "**2 bills · $170.00**", both rows "Billed above EOB allowed amount".
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
- ⚠️ **Known gap, reproduced on production 2026-08-25:** the same paper audited once as a PDF
  and once as a SCAN does NOT share a `billKey`, and is reported as "the same visit is on two
  statements". `billKey` hashes normalised text; the scan path returns the model's
  transcription, which differs from pdf.js extraction by much more than the whitespace and
  case the normalisation handles. Auditing `emma-bill.pdf` and then a rasterisation of it
  produced a $210.00 duplicate hero for a bill that exists once. See TODOS.
- **Empty patient name:** any pre-2026-08-24 audit in history has no `patientName`. ✓ Those
  still participate in duplicate detection exactly as before (empty names share a key).

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

## S1 — A scan is read by the model, not OCR'd locally
**Use case:** tesseract was removed 2026-08-23. Pages with no text layer go to the model as
images, and the model returns its transcription — which is what history, the bill fingerprint
and saved-EOB matching then run on.
**Data:** photograph a bill, or rasterize one: `pdftoppm -png -r 150 test-fixtures/fake-bill.pdf out`.

1. Upload the photo. ✓ Processing is quick and there is **no model download** (the 500MB NER is gone).
2. On review: ✓ the **📷 banner** appears. ✓ The right pane does **not** show extracted text —
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
- **Mixed:** a digital-PDF bill with a photographed EOB. ✓ Bill goes as text, EOB as images.
  The reverse direction (image bill, text EOB) is the one verified above.
- **Too many pages:** more than 20 page images ✓ rejects with a page-count message, before any
  model call is billed.
- **Upside down / cut off:** ✓ the banner tells the user to check exactly this, because the
  model cannot.

**Cost:** 1 audit.

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
- **Wrong document on the SBC zone:** `real-eob/cms-sample-eob.pdf` is an EOB, not an SBC.
  ✓ Rejected with "This doesn't look like a Summary of Benefits."
- **DOL samples:** two further completed SBCs for *different* plans are linked in
  `real-sbc/README.md` and not yet pulled — they would add real variation in deductible and
  cost-share structure rather than three versions of one plan.

**Verified on production 2026-08-25** with `cms-2019.pdf`: extracted cleanly, plan on file as
"Insurance Company 1: Plan Option 1", 2022-01-01 to 2022-12-31, deductible $500 / $1,000.
Trackers were auto-created from its limits ("Children's eye exam 0/1", "Home health care
0/60", both tagged *from your SBC — check the codes*). Step 3 confirmed: the out-of-period
banner fired — "Your plan year ended 2022-12-31 — upload your new SBC." `cms-2025.pdf` and
`cms-older.pdf` not run on production; both extracted cleanly against the API on 2026-08-24.
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

## Always-on checks (every pass)
- **Evidence is real:** spot-check two findings per pass — the quoted line must appear verbatim in the document it cites. A finding whose quote is absent should never render; `verifyEvidence` drops it server-side and logs `unverified evidence dropped`. Check the audit doc's `droppedUnverified` count after each run: a non-zero value is the model inventing evidence, and it is worth reading the log.
- **Disclosure is present:** the audit form shows the "Where your documents go" banner naming Google's Gemini API, above the dropzones.
- **Scanned documents:** upload a photo or a scanned PDF (no text layer). ✓ The 📷 banner fires, the right-hand review pane explains the pages are sent as images rather than showing text, and the audit still returns findings. The stored audit's `bill`/`eob` hold the model's transcription, so history, the bill fingerprint and saved-EOB matching all still work.
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

## Not covered by this suite (documented gaps)
- **Production coverage is partial, not zero.** On 2026-08-25 the live site was exercised in
  a real Chrome with real Gemini calls: password sign-up and sign-in, the bill/EOB pairing fix
  (FAM3 step 2), and FAM1 steps 1-3. Everything else — every M plan, every E plan, S1, P1, G1,
  all the A1 edge cases, and FAM1 step 4 — has only ever been run against the emulator, or not
  at all. Emulator-green is not production-green.
- **The stale line on the processing screen:** "Everything up to analysis happens in your
  browser." Literally true (extraction is local) but written for the redaction era, and it
  still carries that implication. Not yet reworded.
- **App Check is untested in either direction** — it is wired on both sides but OFF, and
  turning it on is the two-step in SETUP.md §7 that takes the app down if reversed.
- **No real EOB has ever been through the product.** There is no public corpus (payer-specific,
  full of PHI), so `family/family-eob.pdf` is synthesized from the CMS sample EOB's column
  vocabulary. Layout variety across real payers remains completely untested, and it is the
  hardest part of the product.
- Out-of-period plan check (needs a bill dated outside 2026; verify the footer variant "service dates fall outside your plan year").
- Older-SBC replace confirmation (needs a second SBC fixture with an earlier coverage period).
- Expired-plan renewal banner (needs a past-dated SBC fixture or a clock change).
- Emulator rules tests (need Java).
- `loadPlan()` failing soft (a Firestore error should leave the empty plan card and no unhandled rejection) — needs network throttling or an injected failure.
- Mobile / narrow widths: nothing in this suite checks the 720px breakpoint, the dashboard grids, or the feedback bubble against the report's action row on a phone.
- The planted **$18 cost-share error** in `fake-eob` (see E1's known gap) — currently not reported as `cost_share_error`.
- Cross-bill duplicates spanning **different providers for the same visit** (e.g. facility + physician billing the same date) — the detector deliberately keys on provider, so this is out of scope by design, not an oversight.
