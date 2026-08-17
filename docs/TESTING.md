# Test Plans — SBC-first

The main case assumes the user has their **Summary of Benefits (SBC)** on file: setup once, then every audit is checked against the plan. Exception cases cover missing documents (no SBC, no EOB, wrong document). Each plan names its use case, exact fixture data, numbered steps, and ✓ checkpoints.

Fixtures: `test-fixtures/` (regenerate HTML: `node test-fixtures/gen-series.mjs`; PDFs render via the browse CLI). Answer key: `test-fixtures/series-expected.json`. Pairings: `test-fixtures/README.md`.

**Session setup:** open https://useclaimright.web.app/app, hard-refresh, sign in. A fresh account starts empty with full daily limits (**10 audits, 3 plan uploads**).

**Budget — the full suite does NOT fit in one day.** Core plans (E1, M1–M6, D1, E2, E4–E7) cost **10 audits + 3 plan uploads**, exactly the daily ceiling, leaving no room for the rate-limit check. Optional **M7** adds 3 more. Run it as:

- **Day 1 (core):** E1 → M1 → M2 → M3 → M4 → M5 → M6 → D1, then the zero-cost plans (E3, E5*, R1, F1). *E5 needs a plan upload.
- **Day 2 (edges):** M7, E2, E4, E6, E7, and the rate-limit check in Always-on.
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
2. Click **Start an audit →**. ✓ The audit form appears with a "← Back to bills" link above the heading; step 1 (EOB) is the first big element and its explainer ("What's an EOB…") sits directly under it. Drag `fake-eob.pdf` onto the EOB zone, `fake-bill.pdf` onto the bill zone. ✓ One "✓ file ✕" row under each zone.
3. Click **Prepare audit →**. ✓ Processing (first run: "Downloading privacy model… N%", ~1–2 min, one-time).
4. Review both tabs. ✓ Canary PHI chipped: Jane Q. Testpatient, DOB 03/14/1985, MRN TESTMRN-424242, AHX-55512345.
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

## E1b — Intake and account-menu details (no audits)
**Use case:** the small copy and affordance fixes a full audit pass wouldn't catch.
**Getting here:** on E1's report, click **← Back to bills**, then **Audit a new bill**. (**New audit** on the report goes to the same form directly; either route clears E1's files.)

1. On the audit page: ✓ both dropzones read "**Drop one or more files**, or click to choose"; the SBC dropzone reads "Drop it here" — one plan only.
2. Drop two bills one at a time. ✓ They accumulate as rows, nothing is replaced, the button becomes "Start 2 audits →", and the summary reads "**2 audits**: 0 bill+EOB pairs, 2 with no EOB" (no saved EOB exists yet on a fresh account).
3. Open **☰**. ✓ Your full email wraps without breaking mid-word; **Sign out**; then **Reset account — erase all my data** below a divider, in red, with a red (not teal) hover.
4. ✓ The "What's an EOB, and where do I find it?" explainer sits under **step 1**, not after the bill section.
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
   ✓ **View** toggles the redacted SBC text; opening a tracker's details clears its tag.
   ✓ The review screen in step 2 shows the SBC itself — never a previously uploaded bill. (The tab label used to read "Bill" here, which made it look like an old document was being reused.)

**Cost:** 1 plan upload.

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
---
## M4 — Batch with a consolidated EOB, plan still applied
**Use case:** many bills + one EOB in a single review-all pass; plan checks apply to every audit in the batch.
**Data:** `series/t2-bill.pdf`, `series/t3-bill.pdf`, `series/t-eob.pdf` (consolidated statement covering t1–t3; leave "save this EOB" checked).

1. Add all three files (any order, any zone — filenames route them). ✓ Rows accumulate; summary "2 audits: 2 bill+EOB pairs"; button "Start 2 audits →".
2. Start. ✓ Per-document redaction progress, then ONE review screen with 3 tabs + "Reviewing <name> — document N of 3".
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

1. Audit the pairs in order. After t5 (remark "5 of 6 visits used"), if its codes are untracked:
   ✓ The 💡 banner offers "Track it" — ONE click creates the tracker fully configured (codes, limit 6, plan year) with no form. The manual form is labeled "**Add a custom limit**" and remains the fallback for unprinted limits.
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
2. ✓ **Hero card** at the top of "Bills & coverage": a yellow ribbon "FOUND BY COMPARING YOUR BILLS TO EACH OTHER", **$175.00 at stake**, "The same visit is on two statements", naming the provider, 90837, and Feb 12 2026, with **Statement A / Statement B** each showing its audited date and amount (never a statement number — those are redacted), plus a "Why this was flagged" explainer. Clicking a statement opens that audit.
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
   ⚠️ **Known gap (observed 2026-08-16):** it did **not** fire on this fixture. The model returned `duplicate_charge` and `charity_care_eligible` alongside `not_in_eob`, and the condition (`findings.length >= 2 && every(not_in_eob)`, `web/js/app.js`) requires *every* finding to be `not_in_eob`. A real mismatched pair usually yields bill-only findings too, so this backstop rarely triggers in practice. The **pre-send banner in step 2 is the effective defence** — it did fire. Treat the backstop as a bonus, not a requirement, until the condition is broadened.
   ✓ **The four totals cards** — the failure signature the banner exists for:

   | Card | Expected | Why |
   |---|---|---|
   | Billed | the ED bill's total (**~$2,115.00**) | the bill's line items |
   | EOB allowed | **$0.00** | the PT EOB adjudicated nothing on this bill |
   | Your responsibility | ≈ the **entire bill** | nothing allowed, so everything lands on you |
   | Worth disputing | ≈ the **entire bill** | every finding is `not_in_eob` |

   ⚠️ These are the same numbers as **M5**, where the missing claim was genuine. The totals cannot distinguish "your insurer never processed this" from "you paired the wrong two documents" — the banner in step 2 is the only thing that can, which is why it must fire *before* the audit is spent.

**Cost:** 0 audits for steps 1–4 (back out with **Start over**); 1 audit for step 5.

## E7 — Reset account returns you to onboarding (destructive — run last)
**Use case:** "erase all my data" means a genuinely fresh account, including the first-run setup screen.
**Data:** none (destructive — run it last, or on a scratch account).

1. With a plan on file and having previously clicked "Skip for now" at least once, open **☰ → Reset account — erase all my data** and confirm.
   ✓ After the reload you land on "**Set up your plan**", not the audit page — the onboarding skip flag is cleared along with the Firestore data.
   ✓ The skip link reads the first-visit wording ("Skip for now — audit a bill first").
   ✓ Audits, saved EOBs, trackers, and the plan are all gone; today's usage counters are intentionally NOT reset.
2. Contrast with **E3 (Remove the plan)**: removing just the plan leaves you on the bills page with the dashed "No plan on file · Add now" reminder under "Your coverage" — deliberate, since removing a plan is a deliberate act, not a fresh start.
3. ✓ Daily counters survive: immediately after a reset, the audit and plan-upload allowances are unchanged (reset is not a way to buy more audits).

**Cost:** 0 audits.

## R1 — Manual redaction: floating chip + undo
**Use case:** hiding something the model missed takes one click at the selection, and mistakes are recoverable.
**Data:** any review screen (reachable without spending an audit — Prepare, then **Start over** to back out).

1. On a review screen, select any text in either pane (e.g. a claim number).
   ✓ A dark "**Hide this**" chip appears immediately above the selection.
2. Click the chip.
   ✓ The text is replaced by a `MANUAL_n` chip **everywhere in all open documents**; the chip disappears; "**Undo**" appears; status reads "Hidden everywhere in these documents."
3. Click **Undo**.
   ✓ The original text returns, the `MANUAL_n` chip is gone, Undo hides, status reads "Undid — restored."
4. Select text OUTSIDE the panes (e.g. the page heading). ✓ No chip appears.
5. The "Hide selection" button below the panes still works — kept as the keyboard/fallback path.
6. **Undo stack**: hide three different strings, then click Undo three times. ✓ Each click restores exactly one hide, most recent first; after the last one, Undo disappears.
7. **Applies to every open document**: on a batch review (M4's 3-tab screen), hide a string that appears in more than one document, then switch tabs. ✓ It's hidden in all of them, and one Undo restores all of them together.
8. Leave and re-enter a review (**Start over**, then Prepare again). ✓ Undo is gone and the status line is clear — the stack does not leak across documents.

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

## Always-on checks (every pass)
- **PHI canary:** every review chips Jane Q. Testpatient / 03/14/1985 / TESTMRN-424242 / AHX-55512345; "Hide selection" redacts across all open documents.
- **Originals destroyed at confirm** — reports and history never show unredacted values.
- **Limits:** 11th audit → "Daily limit of 10 audits reached."; 4th plan upload → "Daily limit of 3 plan uploads reached."

## Background-tab regression check (both bugs found this way)
Chrome freezes `requestAnimationFrame` in hidden tabs. Two features broke on this and were fixed; re-check after touching either:
- Start an audit, **switch to another tab** during "Reading your documents…", wait ~30s, come back. ✓ Extraction completed (pdf.js renders with `intent:"print"`).
- The Hide chip positions via `setTimeout`, not rAF — it must still appear when the tab regains focus after a background selection.

## Not covered by this suite (documented gaps)
- Out-of-period plan check (needs a bill dated outside 2026; verify the footer variant "service dates fall outside your plan year").
- Older-SBC replace confirmation (needs a second SBC fixture with an earlier coverage period).
- Expired-plan renewal banner (needs a past-dated SBC fixture or a clock change).
- Emulator rules tests (need Java).
- `loadPlan()` failing soft (a Firestore error should leave the empty plan card and no unhandled rejection) — needs network throttling or an injected failure.
- Mobile / narrow widths: nothing in this suite checks the 720px breakpoint, the dashboard grids, or the feedback bubble against the report's action row on a phone.
- The planted **$18 cost-share error** in `fake-eob` (see E1's known gap) — currently not reported as `cost_share_error`.
- Cross-bill duplicates spanning **different providers for the same visit** (e.g. facility + physician billing the same date) — the detector deliberately keys on provider, so this is out of scope by design, not an oversight.
