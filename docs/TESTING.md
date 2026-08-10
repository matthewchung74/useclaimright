# Test Plans — SBC-first

The main case assumes the user has their **Summary of Benefits (SBC)** on file: setup once, then every audit is checked against the plan. Exception cases cover missing documents (no SBC, no EOB, wrong document). Each plan names its use case, exact fixture data, numbered steps, and ✓ checkpoints.

Fixtures: `test-fixtures/` (regenerate HTML: `node test-fixtures/gen-series.mjs`; PDFs render via the browse CLI). Answer key: `test-fixtures/series-expected.json`. Pairings: `test-fixtures/README.md`.

**Session setup:** open https://useclaimright.web.app/app, hard-refresh, sign in. A fresh account starts empty with full daily limits (**10 audits, 3 plan uploads**). The full suite below ≈ 7 audits + 3 plan uploads — one fresh day, in the listed order.

**Automated tests first:** `cd functions && npm test`. Rules tests need the emulator + Java: `firebase emulators:exec --only firestore "npm --prefix functions test"`.

---

# Exception first (needs the no-plan state)

## E1 — No SBC on file: honest footer + core audit value
**Use case:** a user who skips plan setup still gets the full bill-vs-EOB audit, and the report admits the plan check didn't run.
**Data:** `fake-bill.pdf` + `fake-eob.pdf` (ED visit, planted errors).

1. A fresh account lands on the **onboarding screen** first: "Set up your plan" card (560px, teal top rule), payoff pitch with mono `$60`/`$175` figures, SBC dropzone with 📄, "What's an SBC?" explainer, and a centered "**Skip for now — audit a bill first**" link. Click **Skip**.
   ✓ The audit page appears; the top shows a **dashed one-line reminder** "No plan on file — add your Summary of Benefits · Add now" (not a big card, not a gold banner); step 1 (EOB) is the first big element and its explainer ("What's an EOB…") sits directly under it.
2. Drag `fake-eob.pdf` onto the EOB zone, `fake-bill.pdf` onto the bill zone. ✓ One "✓ file ✕" row under each zone.
3. Click **Prepare audit →**. ✓ Processing (first run: "Downloading privacy model… N%", ~1–2 min, one-time).
4. Review both tabs. ✓ Canary PHI chipped: Jane Q. Testpatient, DOB 03/14/1985, MRN TESTMRN-424242, AHX-55512345.
5. Click **Looks right — analyze**.
   ✓ **Duplicate charge**: 80053 metabolic panel, $145.50 ×2 (occurrence table count 2).
   ✓ **Cost-share error**: ~$18 (EOB states $186.35; lines sum $168.35).
   ✓ Footer: "**Not checked against your plan** — add your Summary of Benefits at the top of the audit page to enable plan checks."

**Cost:** 1 audit.

good

---

# Main case — the SBC journey

## M1 — One-time plan setup
**Use case:** upload the SBC once; the app configures itself.
**Data:** `fake-sbc.pdf` (Acme Silver PPO: deductible $1,500/$3,000, OOP $6,000/$12,000, period 2026-01-01→12-31, mental health 6/yr, rehab 20/yr, planted "$60 copay" rehab row).

1. Click **Add now** on the reminder line. ✓ The onboarding screen returns, and its skip link now reads "**Not now — back to your audits**" (origin-aware). Drag `fake-sbc.pdf` onto the dropzone.
2. Review screen (single document; the tab is labeled "**Plan (SBC)**", not "Bill"). ✓ Member name/ID chipped. Click **Looks right — analyze**.
3. Back on the audit page:
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
   ✓ "**Copay doesn't match your plan**" ($35.00, medium confidence): mono `SBC` quote of the rehab row, mono `BILL` quote, sentence ending in yellow-highlighted "**$35.00 you may not owe**".
   ✓ "**Billed above EOB allowed**" ($115, high confidence — bill demands $210, EOB says $95).
   ✓ "Worth disputing" = $150 (both findings). ✓ Tracker line "Rehabilitation…: visit 1 of 20". ✓ NO "not checked" footer.
   ✓ Dispute email includes `My plan (SBC) states: "…$60 copay…"`.

**Cost:** 1 audit.

## M3 — Consistent claim: no false positives + combined deductible sourcing
**Use case:** plan terms that agree with the EOB stay silent; deductible card merges SBC target with EOB progress.
**Data:** `series/t1-bill.pdf` + `series/t1-eob.pdf` (90837, $175 billed, $120 to deductible — consistent with the SBC's "$0 coinsurance after deductible" row).

1. Upload both, Prepare, review, analyze.
   ✓ NO plan-mismatch findings. (One "Billed above EOB allowed" $55 finding is expected — the fixture bill demands the full $175.)
   ✓ Mental-health tracker: "visit 1 of 6".
   ✓ Deductible card: "**$120.00 of $1,500.00** — Target from your plan (SBC). As stated on your most recent EOB (2026-01-15)."

**Cost:** 1 audit.

## M4 — Batch with a consolidated EOB, plan still applied
**Use case:** many bills + one EOB in a single review-all pass; plan checks apply to every audit in the batch.
**Data:** `series/t2-bill.pdf`, `series/t3-bill.pdf`, `series/t-eob.pdf` (consolidated statement covering t1–t3; leave "save this EOB" checked).

1. Add all three files (any order, any zone — filenames route them). ✓ Rows accumulate; summary "2 audits: 2 bill+EOB pairs"; button "Start 2 audits →".
2. Start. ✓ Per-document redaction progress, then ONE review screen with 3 tabs + "Reviewing <name> — document N of 3".
3. Confirm once. ✓ "Analyzing audit 1 of 2… 2 of 2" with no pauses; final report + "Batch complete".
   ✓ Each audit matches its claim line in the consolidated EOB (no false `not_in_eob` for t2/t3); mental-health tracker reaches 3/6; deductible $360.
   ✓ **Batch total stated**: "2 audits saved … **$110.00 worth disputing across all 2**. The report below is the last audit only." Each t-audit is $55 (bill demands $175, EOB responsibility $120) — the on-screen report shows one audit, the label shows the batch.
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
   ✓ "**On the bill, missing from the EOB**" (`not_in_eob`) — full $175 worth disputing; mental-health tracker 4/6.

**Cost:** 1 audit.

## M6 — Plan lifecycle: duplicate re-upload
**Use case:** re-uploading the same SBC never re-extracts or duplicates.
**Data:** the same `fake-sbc.pdf`, via the plan line's **Replace**.

1. Replace → pick `fake-sbc.pdf` → confirm the review.
   ✓ "**This plan is already on file.**" — immediate, no "Reading your plan's terms…" step, no plan-upload consumed; plan line unchanged.

**Cost:** 0.

---

# Remaining exceptions

## M7 — Zero-entry tracking from remarks (optional, +3 audits)
**Use case:** when an EOB remark prints the limit, one click tracks it — no typing. (With an SBC on file the trackers already exist; to see this path, delete the mental-health tracker first or run without a plan.)
**Data:** `series/t4-bill.pdf`+`t4-eob.pdf`, `t5-bill.pdf`+`t5-eob.pdf`, `t6-bill.pdf`+`t6-eob.pdf`.

1. Audit the pairs in order. After t5 (remark "5 of 6 visits used"), if its codes are untracked:
   ✓ The 💡 banner offers "Track it" — ONE click creates the tracker fully configured (codes, limit 6, plan year) with no form. The manual form is labeled "**Add a custom limit**" and remains the fallback for unprinted limits.
2. After t6: ✓ tracker red ("Limit reached…"), deductible card $720 of $1,500.

**Cost:** 3 audits.

## E2 — No EOB (bill-only) with SBC on file
**Use case:** bill-only audits still get plan checks; the no-EOB note explains the hierarchy.
**Data:** `series/t5-bill.pdf`, checkbox "I don't have an EOB".

1. Upload the bill, tick the checkbox. ✓ Note appears: bill-only checks + "if your Summary of Benefits is on file (top of this page)… the audit gets stronger when the EOB arrives."
2. Prepare, review (Bill tab only), analyze.
   ✓ Audit completes; NO EOB-comparison finding types (billed_vs_allowed / not_in_eob / cost_share_error); totals show EOB allowed $0.
   ✓ Plan checks may still fire from the bill alone (medium/low confidence at most); no "not checked" footer (service date 2026-05-13 is in-period).

**Cost:** 1 audit.

## E3 — Remove the plan
**Use case:** deleting the plan reverts the app to the no-SBC state without touching trackers or history.
**Data:** none.

1. Click **Remove** on the plan line. ✓ Confirm dialog names the plan and says trackers stay.
2. Confirm. ✓ The full "Add your Summary of Benefits" card returns at the top; trackers remain (tags still cleared/uncleared as they were); deductible card falls back to EOB-stated values ("$120.00 of $1,500.00" from t-series EOBs, no "Target from your plan" line... EOB-only sourcing).

**Cost:** 0.

## E4 — Wrong document on the SBC dropzone
**Use case:** a non-SBC upload is rejected cleanly, storing nothing.
**Data:** `series/t6-bill.pdf` uploaded as an SBC.

1. Upload it to the SBC dropzone, confirm the review.
   ✓ Error: "**This doesn't look like a Summary of Benefits.**" — no plan stored, the empty-state card remains.
   (Note: this consumes a plan upload — the guard runs before extraction.)

**Cost:** 1 plan upload.

## E5 — Restore the plan (closes the loop)
1. Upload `fake-sbc.pdf` again via the top card. ✓ Full M1 checkpoints repeat (plan line, trackers update in place — no duplicates, `source:"sbc"` trackers refreshed).

**Cost:** 1 plan upload (3/3 for the day after M1 + E4 + E5).

---

## E7 — Wrong EOB paired with a bill
**Use case:** pairing the wrong EOB must be called out, not silently reported as "you may not owe the whole bill".
**Data:** copies of two unrelated fixtures given matching stems so they pair by filename — e.g. `mixup-bill.pdf` (copy of `fake-bill.pdf`, ED visit 2026-06-12) + `mixup-eob.pdf` (copy of `series/p1-eob.pdf`, PT 2026-03-20).

1. Upload both, Prepare audit. ✓ They pair ("1 audit: 1 bill+EOB pair").
2. On the review screen, **before** analyzing:
   ✓ Banner: "⚠️ **This EOB may not cover this bill** (mixup-bill.pdf) — they share no service dates and no procedure codes…"
3. Repeat with a genuine pair (`p1-bill.pdf` + `p1-eob.pdf`). ✓ **No banner** — a real pair shares dates and codes.
4. Note: files with clearly different stems (`fake-bill.pdf` + `p1-eob.pdf`) never pair at all — the filename router keeps them separate and the audit reports "1 bill-only, 1 EOB has no matching bill".
5. Backstop (needs a real audit): if a mismatched pair is analyzed anyway and **every** finding comes back `not_in_eob`, the report shows "⚠️ Every line on this bill came back missing from the EOB…" above the totals.

**Cost:** 0 audits for steps 1–4 (back out with **Start over**); 1 audit for step 5.

## E6 — Reset account returns you to onboarding
**Use case:** "erase all my data" means a genuinely fresh account, including the first-run setup screen.
**Data:** none (destructive — run it last, or on a scratch account).

1. With a plan on file and having previously clicked "Skip for now" at least once, open **☰ → Reset account — erase all my data** and confirm.
   ✓ After the reload you land on "**Set up your plan**", not the audit page — the onboarding skip flag is cleared along with the Firestore data.
   ✓ The skip link reads the first-visit wording ("Skip for now — audit a bill first").
   ✓ Audits, saved EOBs, trackers, and the plan are all gone; today's usage counters are intentionally NOT reset.
2. Contrast with **E3 (Remove the plan)**: removing just the plan leaves you on the audit page with the dashed "No plan on file · Add now" reminder — deliberate, since removing a plan is a deliberate act, not a fresh start.

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

**Cost:** 0 audits.

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
