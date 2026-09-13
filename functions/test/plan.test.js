import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { FINDING_TYPES, findingsSchema } from "../schema.js";
import { planApplies, planYearEndFrom, mergeSbcTrackers, deductibleTarget, oopTarget, planYearStartMonthFrom, targetLabel } from "../../web/js/plan.js";
import { planSchema, buildDigest, replaceDecision, planTermsBlock, applyPlanGate } from "../plan.js";

const ajv = new Ajv({ allErrors: true });

test("schema v3: plan finding types exist", () => {
  for (const t of ["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]) {
    assert.ok(FINDING_TYPES.includes(t), `${t} missing`);
  }
});

test("schema v3: a plan finding with sbcQuote validates; missing sbcQuote fails", () => {
  const validate = ajv.compile(findingsSchema);
  const base = {
    serviceDates: ["2026-03-20"], provider: "Testville PT", payerRemarks: [],
    accumulators: { deductibleToDate: null, deductibleLimit: null, oopToDate: null, oopLimit: null, deductibleAppliedThisClaim: null },
    totals: { billed: 120, eobAllowed: 120, patientResponsibility: 120, totalAtStake: 60 },
    occurrenceTable: [{ code: "97110", description: "Therapeutic exercise", count: 1, unitCharges: [120], dates: ["2026-03-20"] }],
    findings: [{
      type: "copay_mismatch", lineRef: "97110",
      description: "Bill applies $120.00 where your plan says a $60 copay.",
      amountAtStake: 60, confidence: "medium",
      evidence: { billQuote: "97110 Therapeutic exercise $120.00", eobQuote: "", sbcQuote: "Rehabilitation services — $60 copay/visit, deductible does not apply" },
    }],
  };
  assert.equal(validate(base), true, ajv.errorsText(validate.errors));
  delete base.findings[0].evidence.sbcQuote;
  assert.equal(validate(base), false, "sbcQuote must be required");
});

const PLAN = { planYearStart: "2026-01-01", planYearEnd: "2026-12-31", deductible: { individual: 1500, family: null } };

test("planApplies: in-window date applies; all-out dates do not; no plan / no dates reported", () => {
  assert.deepEqual(planApplies(["2026-03-20"], PLAN), { applies: true, reason: null });
  assert.deepEqual(planApplies(["2025-11-02"], PLAN), { applies: false, reason: "out_of_period" });
  assert.deepEqual(planApplies(["2026-03-20"], null), { applies: false, reason: "no_plan" });
  assert.deepEqual(planApplies([], PLAN), { applies: false, reason: "no_dates" });
  // mixed dates: any in-window date applies
  assert.equal(planApplies(["2025-12-30", "2026-01-02"], PLAN).applies, true);
  // boundary dates are inclusive on both ends
  assert.equal(planApplies(["2026-01-01"], PLAN).applies, true);
  assert.equal(planApplies(["2026-12-31"], PLAN).applies, true);
  // garbage date strings never apply
  assert.equal(planApplies(["not-a-date"], PLAN).applies, false);
  // a plan missing either bound cannot be applied
  // Was no_plan until 2026-09-10. An employer booklet prints the coverage period
  // once, in Plan Information, not on each schedule — so a correctly extracted
  // plan arrived with no end date and applied to nothing, while the report told
  // the member to add the Summary of Benefits they had just added.
  assert.deepEqual(planApplies(["2026-03-20"], { planYearStart: "2026-01-01", planYearEnd: null }), { applies: true, reason: null });
});

test("mergeSbcTrackers: creates new, updates sbc-sourced, never touches manual", () => {
  const limits = [{ label: "Outpatient mental health", codesHint: ["90832", "90834", "90837"], visitsPerYear: 6 }];
  const fresh = mergeSbcTrackers([], limits, 1);
  assert.equal(fresh.create.length, 1);
  assert.deepEqual(fresh.create[0], { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6, planYearStartMonth: 1, source: "sbc" });
  // manual tracker with overlapping codes blocks creation
  const manual = [{ id: "m1", label: "Therapy", codes: ["90837"], limit: 6 }];
  assert.deepEqual(mergeSbcTrackers(manual, limits, 1), { create: [], update: [], remove: [] });
  // sbc-sourced tracker with overlapping codes gets updated in place
  const sbcOwned = [{ id: "s1", label: "Old label", codes: ["90837"], limit: 5, source: "sbc" }];
  const upd = mergeSbcTrackers(sbcOwned, limits, 1);
  assert.equal(upd.create.length, 0);
  assert.deepEqual(upd.update, [{ id: "s1", changes: { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6 } }]);
  // a limit without visitsPerYear or codes creates nothing
  assert.deepEqual(mergeSbcTrackers([], [{ label: "X", codesHint: [], visitsPerYear: null }], 1), { create: [], update: [], remove: [] });
  // two SBC rows sharing a code must not create two overlapping trackers
  const twoRows = mergeSbcTrackers([], [
    { label: "Mental health", codesHint: ["90837"], visitsPerYear: 6 },
    { label: "Therapy visits", codesHint: ["90837", "90834"], visitsPerYear: 6 },
  ], 1);
  assert.equal(twoRows.create.length, 1);
  // code matching is case/whitespace-insensitive
  const ci = mergeSbcTrackers([{ id: "m1", label: "T", codes: [" 90837 "], limit: 6 }],
    [{ label: "MH", codesHint: ["90837"], visitsPerYear: 6 }], 1);
  assert.deepEqual(ci, { create: [], update: [], remove: [] });
});

// Found on production 2026-09-12, running C1 then C2 back to back: a UMR
// booklet replaced by Kaiser CalPERS and then by BCBS Kansas left the coverage
// list showing "Private Duty Nursing 0/14" and "Developmental Delays 1/20" —
// UMR's benefits, on a Kansas plan, badged "from your plan (SBC)". Replace
// created and updated and never removed, so a member who changes insurer
// accumulates every plan they have ever uploaded.
test("mergeSbcTrackers: replacing a plan drops the old plan's limits, keeps the member's", () => {
  const existing = [
    { id: "s1", label: "Outpatient mental health", codes: ["90837"], limit: 6, source: "sbc" },
    { id: "s2", label: "Private duty nursing", codes: ["99504"], limit: 14, source: "sbc" },
    { id: "m1", label: "My own limit", codes: ["97110"], limit: 20 },
    { id: "r1", label: "From an EOB remark", codes: ["70450"], limit: 3, source: "remark" },
  ];
  // The new plan names only the mental-health row.
  const { create, update, remove } = mergeSbcTrackers(existing,
    [{ label: "Mental health visits", codesHint: ["90837"], visitsPerYear: 12 }], 1);

  assert.deepEqual(create, []);
  assert.deepEqual(update, [{ id: "s1", changes: { label: "Mental health visits", codes: ["90837"], limit: 12 } }]);
  // s2 is the old plan's and goes. m1 and r1 are the member's and stay — the
  // same line Remove draws, in the same words.
  assert.deepEqual(remove, ["s2"]);
});

// A plan with no limits at all is still a plan. If it swept the board it would
// be indistinguishable from Remove, which it is not.
test("mergeSbcTrackers: a plan stating no limits still clears the previous plan's", () => {
  const existing = [
    { id: "s1", label: "Acupuncture", codes: ["97810"], limit: 20, source: "sbc" },
    { id: "m1", label: "Mine", codes: ["97110"], limit: 20 },
  ];
  const { create, update, remove } = mergeSbcTrackers(existing, [], 1);
  assert.deepEqual({ create, update, remove }, { create: [], update: [], remove: ["s1"] });
});

test("deductibleTarget: SBC owns the limit; EOB fills gaps; conflict when both differ > $1", () => {
  assert.deepEqual(deductibleTarget(PLAN, null), { limit: 1500, source: "sbc", scope: "individual", conflict: false, sbcLimit: 1500 });
  assert.deepEqual(deductibleTarget(null, { deductibleLimit: 1500 }), { limit: 1500, source: "eob", scope: null, conflict: false, sbcLimit: null });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 2000 }), { limit: 1500, source: "sbc", scope: "individual", conflict: true, sbcLimit: 1500 });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 1500.5 }), { limit: 1500, source: "sbc", scope: "individual", conflict: false, sbcLimit: 1500 });
  assert.deepEqual(deductibleTarget(null, null), { limit: null, source: null, scope: null, conflict: false, sbcLimit: null });
  // family-only SBC deductible (individual null): individual target intentionally stays null/EOB-sourced
  assert.deepEqual(deductibleTarget({ deductible: { individual: null, family: 3000 } }, { deductibleLimit: 1500 }),
    { limit: 1500, source: "eob", scope: null, conflict: false, sbcLimit: null });
});

test("oopTarget: SBC owns the limit, EOB fills gaps, conflicts flagged", () => {
  assert.deepEqual(oopTarget({ oopMax: { individual: 6000, family: 12000 } }, null), { limit: 6000, source: "sbc", scope: "individual", conflict: false, sbcLimit: 6000 });
  assert.deepEqual(oopTarget(null, { oopLimit: 6000 }), { limit: 6000, source: "eob", scope: null, conflict: false, sbcLimit: null });
  assert.deepEqual(oopTarget({ oopMax: { individual: 6000 } }, { oopLimit: 8150 }), { limit: 6000, source: "sbc", scope: "individual", conflict: true, sbcLimit: 6000 });
  assert.deepEqual(oopTarget(null, null), { limit: null, source: null, scope: null, conflict: false, sbcLimit: null });
});

test("planYearStartMonthFrom: extracts month, defaults to 1", () => {
  assert.equal(planYearStartMonthFrom("2026-07-01"), 7);
  assert.equal(planYearStartMonthFrom(null), 1);
  assert.equal(planYearStartMonthFrom("garbage"), 1);
});

const STRUCTURED = {
  planName: "Acme Silver PPO", planYearStart: "2026-01-01", planYearEnd: "2026-12-31",
  deductible: { individual: 1500, family: 3000 }, oopMax: { individual: 6000, family: 12000 },
  limits: [{ label: "Outpatient mental health", codesHint: ["90837"], visitsPerYear: 6 }],
  // verbatim holds ONLY the cost-share phrase, as real extractions do — the
  // service name lives in `category`. A fixture that inlined the category here
  // hid a digest bug that dropped it entirely.
  costShares: [{ category: "Rehabilitation services", verbatim: "$60 copay/visit, deductible does not apply", copay: 60, coinsurancePct: null, deductibleApplies: false }],
};

test("planSchema validates the structured shape; rejects extra properties", () => {
  const validate = new Ajv({ allErrors: true }).compile(planSchema);
  assert.equal(validate(STRUCTURED), true, new Ajv().errorsText(validate?.errors));
  assert.equal(validate({ ...STRUCTURED, bogus: 1 }), false);
});

const ALL_NULL = {
  planName: null, planYearStart: null, planYearEnd: null,
  deductible: { individual: null, family: null }, oopMax: { individual: null, family: null },
  limits: [], costShares: [],
};

test("planSchema ACCEPTS an all-null plan — the not-an-SBC gate depends on this", () => {
  // A junk upload makes the model return nulls; validation must pass so the
  // callable can reject with the clean "doesn't look like an SBC" message
  // instead of a confusing "invalid output" error.
  const validate = new Ajv({ allErrors: true }).compile(planSchema);
  assert.equal(validate(ALL_NULL), true);
});

test("buildDigest survives an all-null plan without crashing", () => {
  const d = buildDigest(ALL_NULL);
  assert.equal(typeof d, "string");
  assert.ok(d.includes("not stated"));
});

test("buildDigest is deterministic, contains verbatim rows and key numbers, caps at 2000 chars", () => {
  const d1 = buildDigest(STRUCTURED), d2 = buildDigest(STRUCTURED);
  assert.equal(d1, d2);
  assert.ok(d1.includes("Acme Silver PPO"));
  assert.ok(d1.includes("$60 copay/visit"));
  assert.ok(d1.includes("1500"));
  assert.ok(d1.length <= 2000);
  const bloated = { ...STRUCTURED, costShares: Array.from({ length: 100 }, (_, i) => ({ category: `C${i}`, verbatim: "x".repeat(80), copay: null, coinsurancePct: null, deductibleApplies: null })) };
  assert.ok(buildDigest(bloated).length <= 2000);
});

test("buildDigest names each row's service category, keeping identical cost shares distinct", () => {
  // Live SBC: "Specialist visit" and "Rehabilitation services" carry the SAME
  // cost-share text. Without the category the digest is two identical lines and
  // nothing can map a billed PT code to the right one — the model then correctly
  // stays silent, and a real copay mismatch goes unreported.
  const d = buildDigest({
    ...STRUCTURED,
    costShares: [
      { category: "Specialist visit", verbatim: "$60 copay/visit, deductible does not apply", copay: 60, coinsurancePct: null, deductibleApplies: false },
      { category: "Rehabilitation services (physical, occupational therapy)", verbatim: "$60 copay/visit, deductible does not apply", copay: 60, coinsurancePct: null, deductibleApplies: false },
    ],
  });
  assert.ok(d.includes("Specialist visit"));
  assert.ok(d.includes("Rehabilitation services (physical, occupational therapy)"));
  const rows = d.split("\n").filter((l) => l.startsWith("Row: "));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows).size, 2, "rows must be distinguishable from each other");
});

test("buildDigest tolerates a row with no category", () => {
  const d = buildDigest({ ...STRUCTURED, costShares: [{ category: null, verbatim: "$40 copay", copay: 40, coinsurancePct: null, deductibleApplies: null }] });
  assert.ok(d.includes("$40 copay"));
});

test("replaceDecision: store fresh/newer/forced; confirm on older", () => {
  assert.equal(replaceDecision(null, STRUCTURED, false), "store");
  const older = { ...STRUCTURED, planYearStart: "2025-01-01", planYearEnd: "2025-12-31" };
  assert.equal(replaceDecision(STRUCTURED, older, false), "confirm_older");
  assert.equal(replaceDecision(STRUCTURED, older, true), "store");
  assert.equal(replaceDecision(older, STRUCTURED, false), "store"); // newer replaces older freely
  assert.equal(replaceDecision(STRUCTURED, { ...STRUCTURED, planYearStart: null }, false), "store"); // unknown period: store (upload-time warning is the client's job)
});

test("planTermsBlock fences the digest and forbids inference", () => {
  const b = planTermsBlock("DIGEST");
  assert.ok(b.includes("PLAN TERMS"));
  assert.ok(b.includes("DIGEST"));
  assert.ok(/only when the plan term is explicit/i.test(b));
});

test("planTermsBlock guards the two false-positive modes seen live", () => {
  const b = planTermsBlock("DIGEST");
  // 1. Wrong-row matching: psychotherapy matched the generic "specialist visit" row.
  assert.ok(/most specific wins/i.test(b), "must require most-specific row matching");
  assert.ok(/behavioral-health\s+codes belong to the mental-health row/i.test(b));
  assert.ok(/emit NO plan finding/i.test(b), "must require silence when the mapping is a guess");
  // 2. "after deductible" misread as "deductible does not apply".
  assert.ok(/after deductible[\s\S]*applying the charge to the deductible is CORRECT/i.test(b));
  assert.ok(/deductible_misapplied ONLY when the matched row\s*\n?explicitly states the deductible does NOT apply/i.test(b));
});

test("applyPlanGate: applies in-window (inclusive bounds), strips straggler plan findings when not applied, clamps totals", () => {
  const mk = (dates, findings = [], totalAtStake = 0) => ({
    serviceDates: dates,
    findings,
    totals: { billed: 0, eobAllowed: 0, patientResponsibility: 0, totalAtStake },
  });
  const planFinding = { type: "copay_mismatch", amountAtStake: 60 };
  const normalFinding = { type: "duplicate_charge", amountAtStake: 145.5 };

  // applies: boundary date, nothing stripped
  let r = applyPlanGate(mk(["2026-12-31"], [planFinding, normalFinding], 205.5), STRUCTURED);
  assert.equal(r.planApplied, true);
  assert.equal(r.planReason, null);
  assert.equal(r.result.findings.length, 2);

  // out of period: plan findings stripped, totalAtStake reduced
  r = applyPlanGate(mk(["2025-06-01"], [planFinding, normalFinding], 205.5), STRUCTURED);
  assert.equal(r.planApplied, false);
  assert.equal(r.planReason, "out_of_period");
  assert.deepEqual(r.result.findings, [normalFinding]);
  assert.equal(r.result.totals.totalAtStake, 145.5);

  // stripping everything leaves nothing at stake. (Formerly a clamp against a
  // negative subtraction; the total is now re-derived from the surviving
  // findings, so there is no subtraction to go negative.)
  r = applyPlanGate(mk(["2025-06-01"], [{ type: "deductible_misapplied", amountAtStake: 999 }], 10), STRUCTURED);
  assert.equal(r.result.totals.totalAtStake, 0);

  // no plan / no dates
  assert.equal(applyPlanGate(mk(["2026-03-01"]), null).planReason, "no_plan");
  assert.equal(applyPlanGate(mk([]), STRUCTURED).planReason, "no_dates");
});

// --- family vs individual limits ---
// Reproduces against test-fixtures/real-sbc/*.pdf: every CMS sample SBC is
// "Coverage for: Family" at $500 individual / $1,000 family, $2,500 / $5,000 OOP.

const FAMILY_PLAN = {
  deductible: { individual: 500, family: 1000 },
  oopMax: { individual: 2500, family: 5000 },
};

test("a family EOB accrues against the FAMILY deductible, not the individual one", () => {
  // The live bug: $640 counted toward a $1,000 family deductible was measured
  // against the $500 individual target, rendering 128% of a limit they were
  // 64% through — and calling the EOB's correct figure a conflict.
  const t = deductibleTarget(FAMILY_PLAN, { deductibleLimit: 1000, deductibleToDate: 640 });
  assert.equal(t.limit, 1000);
  assert.equal(t.scope, "family");
  assert.equal(t.conflict, false, "the family limit is not in conflict with the plan — it IS the plan");
});

test("an individual EOB still picks the individual limit", () => {
  const t = deductibleTarget(FAMILY_PLAN, { deductibleLimit: 500, deductibleToDate: 120 });
  assert.equal(t.limit, 500);
  assert.equal(t.scope, "individual");
  assert.equal(t.conflict, false);
});

test("out-of-pocket max resolves scope the same way", () => {
  assert.equal(oopTarget(FAMILY_PLAN, { oopLimit: 5000 }).scope, "family");
  assert.equal(oopTarget(FAMILY_PLAN, { oopLimit: 2500 }).scope, "individual");
});

test("a limit matching NEITHER figure is still a genuine conflict", () => {
  // Precedence is unchanged: the SBC keeps the limit and the UI shows both.
  const t = deductibleTarget(FAMILY_PLAN, { deductibleLimit: 3000 });
  assert.equal(t.conflict, true);
  assert.equal(t.limit, 500);
  assert.equal(t.source, "sbc");
});

test("with no EOB figure, individual is the default", () => {
  const t = deductibleTarget(FAMILY_PLAN, {});
  assert.equal(t.limit, 500);
  assert.equal(t.scope, "individual");
});

test("mergeSbcTrackers: a confirmed tracker keeps the codes the member chose", () => {
  // The card asks members to check SBC-inferred codes. Re-uploading a plan must
  // not discard that answer. Found live: the same SBC as text and as a scan
  // inferred different rehab codes, so Replace silently changed which visits
  // counted.
  const existing = [{ id: "t1", source: "sbc", confirmed: true, codes: ["97110", "97161", "97165"] }];
  const limits = [{ label: "Rehabilitation services", codesHint: ["97110", "97140"], visitsPerYear: 20 }];
  const { update, create } = mergeSbcTrackers(existing, limits, 1);
  assert.equal(create.length, 0);
  assert.equal(update.length, 1);
  assert.deepEqual(update[0].changes, { label: "Rehabilitation services", limit: 20 },
    "label and limit are printed on the SBC and update; codes are not and must not");
  assert.ok(!("codes" in update[0].changes), "the member's confirmed codes survive");
});

test("mergeSbcTrackers: an unconfirmed tracker still takes the newer codes", () => {
  const existing = [{ id: "t1", source: "sbc", codes: ["97110", "97161"] }];
  const limits = [{ label: "Rehabilitation services", codesHint: ["97110", "97140"], visitsPerYear: 20 }];
  const { update } = mergeSbcTrackers(existing, limits, 1);
  assert.deepEqual(update[0].changes.codes, ["97110", "97140"],
    "nothing was confirmed, so the freshest reading wins");
});

// --- FAM2's arithmetic, without FAM2's preconditions ---
// FAM2 needs a real SBC on file AND the family EOB to be the most recent
// accumulator source. On an account with later EOBs the snapshot comes from
// those instead, so the browser step cannot be observed. The substance is this
// function, and it was never covered.
const FAM2_PLAN = { deductible: { individual: 500, family: 1000 }, oopMax: { individual: 2500, family: 5000 } };

test("deductibleTarget: an EOB quoting the FAMILY figure is measured against the family", () => {
  // The planted defect: $640 applied against a $1,000 family deductible, measured
  // against the $500 individual, renders 128% of a deductible they are 64% through.
  const t = deductibleTarget(FAM2_PLAN, { deductibleToDate: 640, deductibleLimit: 1000 });
  assert.equal(t.limit, 1000);
  assert.equal(t.scope, "family");
  assert.equal(t.conflict, false, "the family figure IS the plan, not a disagreement with it");
});

test("deductibleTarget: an EOB quoting the INDIVIDUAL figure stays individual", () => {
  const t = deductibleTarget(FAM2_PLAN, { deductibleToDate: 300, deductibleLimit: 500 });
  assert.equal(t.limit, 500);
  assert.equal(t.scope, "individual");
  assert.equal(t.conflict, false);
});

test("deductibleTarget: an EOB that matches neither is a real conflict", () => {
  const t = deductibleTarget(FAM2_PLAN, { deductibleLimit: 750 });
  assert.equal(t.limit, 500, "the SBC is still the target");
  assert.equal(t.conflict, true, "but the disagreement is surfaced");
});

test("oopTarget: resolves family the same way", () => {
  const t = oopTarget(FAM2_PLAN, { oopLimit: 5000 });
  assert.equal(t.limit, 5000);
  assert.equal(t.scope, "family");
});

// The scope was computed correctly and then thrown away at the point of display:
// deductibleTarget returned scope "family", and the card said only "Target from
// your plan (SBC)". A household measuring $640 against a $1,000 family deductible
// is right, but from the card it is indistinguishable from the $500 individual
// bug that shipped before it — same words, different number.
test("targetLabel names which of the plan's two numbers a card is measured against", () => {
  assert.equal(targetLabel("family"), "Family target");
  assert.equal(targetLabel("individual"), "Individual target");
  // No scope means the figure came from the EOB alone, where there is only one
  // number and nothing to disambiguate. Naming it would invent a distinction.
  assert.equal(targetLabel(null), "Target");
  assert.equal(targetLabel(undefined), "Target");
});

test("targetLabel composes with the target it describes", () => {
  const family = deductibleTarget({ deductible: { individual: 500, family: 1000 } }, { deductibleLimit: 1000 });
  assert.equal(targetLabel(family.scope), "Family target");
  assert.equal(family.limit, 1000);
  assert.equal(family.conflict, false, "the family figure is the plan, not a disagreement with it");

  const eobOnly = deductibleTarget(null, { deductibleLimit: 1500 });
  assert.equal(targetLabel(eobOnly.scope), "Target");
});

// A card cannot say "$5,000.00 of $500.00". Found with a member's real EOB
// sitting against a plan extracted from a different document: the amount
// accrued came from the insurer, the limit came from the SBC, and the two
// belonged to different plans. A note explained it; the headline still read
// 1000% and made every other number on the page look wrong.
test("deductibleTarget: the insurer's running total cannot exceed the limit it counts toward", () => {
  const sbc = { deductible: { individual: 500, family: 1500 } };
  const eob = { deductibleLimit: 5000, deductibleToDate: 5000 };
  assert.deepEqual(deductibleTarget(sbc, eob),
    { limit: 5000, source: "eob", scope: null, conflict: true, sbcLimit: 500 });
});

test("oopTarget: the same, for out-of-pocket", () => {
  const sbc = { oopMax: { individual: 2500, family: 5000 } };
  assert.deepEqual(oopTarget(sbc, { oopLimit: 9000, oopToDate: 6000 }),
    { limit: 9000, source: "eob", scope: null, conflict: true, sbcLimit: 2500 });
});

// Only when the data contradicts the SBC. A disagreement the member has not yet
// spent past is still the SBC's to own, with the existing note.
test("deductibleTarget: a disagreement below the limit keeps the SBC and flags it", () => {
  const sbc = { deductible: { individual: 500, family: 1500 } };
  assert.deepEqual(deductibleTarget(sbc, { deductibleLimit: 5000, deductibleToDate: 200 }),
    { limit: 500, source: "sbc", scope: "individual", conflict: true, sbcLimit: 500 });
});

// FAM2's family target must survive: matching the family figure is not a conflict.
test("deductibleTarget: a family target still wins over the individual one", () => {
  const sbc = { deductible: { individual: 500, family: 1500 } };
  assert.deepEqual(deductibleTarget(sbc, { deductibleLimit: 1500, deductibleToDate: 640 }),
    { limit: 1500, source: "sbc", scope: "family", conflict: false, sbcLimit: 1500 });
});

// --- a plan year printed only as a start date -------------------------------

test("planYearEndFrom: a printed end date is used as printed", () => {
  assert.deepEqual(planYearEndFrom({ planYearStart: "2026-01-01", planYearEnd: "2026-06-30" }),
    { end: "2026-06-30", inferred: false });
});

test("planYearEndFrom: a missing end becomes one year less a day, and says so", () => {
  assert.deepEqual(planYearEndFrom({ planYearStart: "2026-01-01" }),
    { end: "2026-12-31", inferred: true });
  assert.deepEqual(planYearEndFrom({ planYearStart: "2025-07-01" }),
    { end: "2026-06-30", inferred: true });
});

test("planYearEndFrom: a leap year does not shift the window", () => {
  assert.deepEqual(planYearEndFrom({ planYearStart: "2024-01-01" }),
    { end: "2024-12-31", inferred: true });
});

test("planYearEndFrom: no start date infers nothing", () => {
  assert.deepEqual(planYearEndFrom({}), { end: null, inferred: false });
  assert.deepEqual(planYearEndFrom({ planYearStart: "not a date" }), { end: null, inferred: false });
});

// The inferred window must still expire — a plan with a start and no end that
// applied forever would check 2030 bills against 2026 terms.
test("planApplies: an inferred year still runs out", () => {
  const p = { planYearStart: "2026-01-01" };
  assert.equal(planApplies(["2026-12-31"], p).applies, true);
  assert.deepEqual(planApplies(["2027-01-01"], p), { applies: false, reason: "out_of_period" });
});
