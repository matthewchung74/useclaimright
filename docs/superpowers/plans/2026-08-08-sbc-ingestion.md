# SBC Ingestion & Plan Cross-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users upload their Summary of Benefits (SBC) once; the app auto-configures deductible targets and visit-limit trackers, shows a "Your plan" card, and every audit cross-checks the bill/EOB against the plan's printed terms with new mismatch finding types.

**Architecture:** A new callable `extractPlan` parses the redacted SBC via Gemini into an Ajv-validated structured object plus a deterministic ≤2,000-char digest, stored at `users/{uid}/plan/active` (Function sole writer). At audit time `analyze` fetches the plan server-side and appends the digest to the existing single Gemini call; `planApplied` is computed post-hoc from returned service dates vs the plan year. Pure logic (applicability, tracker merge, deductible precedence, replace decision, digest) lives in unit-testable modules mirroring `web/js/batch.js` / `web/js/usage.js`.

**Tech Stack:** Firebase callable Functions v2 (Node ESM), Gemini via `functions/providers/gemini.js` adapter (`gemini-3.6-flash`), Ajv, Firestore, vanilla-JS ESM client, `node:test` in `functions/test/` importing client modules by relative path.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-sbc-ingestion-design.md` — the source of truth; deviations must be flagged.
- Extraction is verbatim-or-null: the model must NEVER invent numbers not printed in the document (same rule as the audit prompt).
- Rate limits: `analyze` 10/day (existing, unchanged); `extractPlan` 3/day (new counter fields in the SAME `users/{uid}/meta/usage` doc).
- Single active plan: fixed doc ID `active`; replace is atomic on successful extraction only.
- A plan problem must NEVER block a bill audit (`planApplied: false` + reason instead).
- UI: do NOT load Newsreader/Instrument Sans/IBM Plex Mono; use `ui-monospace,Menlo,monospace` (matches `.chip`). Highlighter `#E8F25C` appears ONLY as an inline `<mark>` on the dollar delta — never on borders, fills, or quotes. No soft `#F5F8BD`.
- New client logic must be pure and tested from `functions/test/*.test.js` via `node:test` (pattern: `functions/test/batch.test.js` imports `../../web/js/batch.js`).
- Run `graphify update .` after code changes (project rule). Commits end with the standard Co-Authored-By footer used in this repo.
- The daily-limit user is mid-testing: do not consume live audits except in Task 11's verification.

## File Structure

- `functions/schema.js` (modify) — 4 new finding types; `evidence.sbcQuote` field.
- `functions/plan.js` (create) — `planSchema`, `buildDigest()`, `replaceDecision()`, `PLAN_EXTRACT_INSTRUCTIONS`, `planTermsBlock()`. Server-side pure logic + prompt text.
- `functions/providers/gemini.js` (modify) — `runPlanExtract()`; `runAudit()` gains optional `planDigest` param.
- `functions/index.js` (modify) — `extractPlan` callable; `analyze` plan fetch + `planApplied` post-check.
- `firestore.rules` (modify) — `users/{uid}/plan/{docId}` rules.
- `functions/test/rules.test.js` (modify) — plan-path rule tests.
- `web/js/plan.js` (create) — client pure logic: `planApplies()`, `mergeSbcTrackers()`, `deductibleTarget()`, `planYearStartMonthFrom()`.
- `functions/test/plan.test.js` (create) — tests for schema, both plan.js modules, digest.
- `web/js/app.js` (modify) — plan state/load, SBC upload flow, "Your plan" card render, tracker auto-create, deductible precedence, plan-finding render, not-checked footer.
- `web/app.html` (modify) — plan card + SBC dropzone + explainer markup; `.xq`/`.src`/`mark`/plan-grid CSS; `#plan-note` report footer.
- `test-fixtures/gen-series.mjs` (modify) — `sbc()` generator → `test-fixtures/fake-sbc.html`; answer-key entry.

---

### Task 1: Schema v3 — plan finding types and `sbcQuote` evidence

**Files:**
- Modify: `functions/schema.js` (FINDING_TYPES array at top; `evidence` object ~L52-60)
- Test: `functions/test/plan.test.js` (create; schema section)

**Interfaces:**
- Produces: `FINDING_TYPES` now includes `"copay_mismatch" | "coinsurance_mismatch" | "deductible_misapplied" | "not_covered_per_plan"`. Every finding's `evidence` object now has required string `sbcQuote` (empty string for non-plan findings). All later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `functions/test/plan.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { FINDING_TYPES, findingsSchema } from "../schema.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && node --test test/plan.test.js`
Expected: FAIL — `copay_mismatch missing` (and the sbcQuote test fails since the field is unknown/`additionalProperties:false`).

- [ ] **Step 3: Implement**

In `functions/schema.js`, extend the types array:

```js
export const FINDING_TYPES = [
  "duplicate_charge",
  "unbundling",
  "wrong_code",
  "billed_vs_allowed_mismatch",
  "not_in_eob",
  "cost_share_error",
  "charity_care_eligible",
  // v3 — plan (SBC) cross-check findings
  "copay_mismatch",
  "coinsurance_mismatch",
  "deductible_misapplied",
  "not_covered_per_plan",
];
```

And change the `evidence` block to:

```js
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["billQuote", "eobQuote", "sbcQuote"],
            properties: {
              billQuote: { type: "string" },
              eobQuote: { type: "string" },
              sbcQuote: { type: "string" }, // "" unless the finding cites the plan
            },
          },
```

- [ ] **Step 4: Run the full suite** — `cd functions && npm test`. Expected: new tests PASS. If `functions/test/schema.test.js` constructs findings objects with `additionalProperties:false` evidence, add `sbcQuote: ""` to those literals until the suite is green (that is a v3-required migration, not a test hack).

- [ ] **Step 5: Commit** — `git add functions/schema.js functions/test/plan.test.js functions/test/schema.test.js && git commit` message: `feat(schema): add plan cross-check finding types and evidence.sbcQuote`

---

### Task 2: Client pure logic — `web/js/plan.js`

**Files:**
- Create: `web/js/plan.js`
- Test: `functions/test/plan.test.js` (append)

**Interfaces:**
- Produces (exact signatures, consumed by Tasks 8–10):
  - `planApplies(serviceDates: string[], structured: {planYearStart, planYearEnd}|null) -> {applies: boolean, reason: null|"no_plan"|"no_dates"|"out_of_period"}`
  - `mergeSbcTrackers(existing: [{id, label, codes[], limit, source?}], limits: [{label, codesHint[], visitsPerYear}], planYearStartMonth: number) -> {create: [{label, codes, limit, planYearStartMonth, source:"sbc"}], update: [{id, changes:{label, codes, limit}}]}`
  - `deductibleTarget(structured: {deductible:{individual}}|null, snapshot: {deductibleLimit}|null) -> {limit: number|null, source: "sbc"|"eob"|null, conflict: boolean}`
  - `planYearStartMonthFrom(planYearStart: string|null) -> number` (1–12; 1 when null/invalid)

- [ ] **Step 1: Write the failing tests** — append to `functions/test/plan.test.js`:

```js
import { planApplies, mergeSbcTrackers, deductibleTarget, planYearStartMonthFrom } from "../../web/js/plan.js";

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
  assert.deepEqual(planApplies(["2026-03-20"], { planYearStart: "2026-01-01", planYearEnd: null }), { applies: false, reason: "no_plan" });
});

test("mergeSbcTrackers: creates new, updates sbc-sourced, never touches manual", () => {
  const limits = [{ label: "Outpatient mental health", codesHint: ["90832", "90834", "90837"], visitsPerYear: 6 }];
  const fresh = mergeSbcTrackers([], limits, 1);
  assert.equal(fresh.create.length, 1);
  assert.deepEqual(fresh.create[0], { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6, planYearStartMonth: 1, source: "sbc" });
  // manual tracker with overlapping codes blocks creation
  const manual = [{ id: "m1", label: "Therapy", codes: ["90837"], limit: 6 }];
  assert.deepEqual(mergeSbcTrackers(manual, limits, 1), { create: [], update: [] });
  // sbc-sourced tracker with overlapping codes gets updated in place
  const sbcOwned = [{ id: "s1", label: "Old label", codes: ["90837"], limit: 5, source: "sbc" }];
  const upd = mergeSbcTrackers(sbcOwned, limits, 1);
  assert.equal(upd.create.length, 0);
  assert.deepEqual(upd.update, [{ id: "s1", changes: { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6 } }]);
  // a limit without visitsPerYear or codes creates nothing
  assert.deepEqual(mergeSbcTrackers([], [{ label: "X", codesHint: [], visitsPerYear: null }], 1), { create: [], update: [] });
  // two SBC rows sharing a code must not create two overlapping trackers
  const twoRows = mergeSbcTrackers([], [
    { label: "Mental health", codesHint: ["90837"], visitsPerYear: 6 },
    { label: "Therapy visits", codesHint: ["90837", "90834"], visitsPerYear: 6 },
  ], 1);
  assert.equal(twoRows.create.length, 1);
  // code matching is case/whitespace-insensitive
  const ci = mergeSbcTrackers([{ id: "m1", label: "T", codes: [" 90837 "], limit: 6 }],
    [{ label: "MH", codesHint: ["90837"], visitsPerYear: 6 }], 1);
  assert.deepEqual(ci, { create: [], update: [] });
});

test("deductibleTarget: SBC owns the limit; EOB fills gaps; conflict when both differ > $1", () => {
  assert.deepEqual(deductibleTarget(PLAN, null), { limit: 1500, source: "sbc", conflict: false });
  assert.deepEqual(deductibleTarget(null, { deductibleLimit: 1500 }), { limit: 1500, source: "eob", conflict: false });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 2000 }), { limit: 1500, source: "sbc", conflict: true });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 1500.5 }), { limit: 1500, source: "sbc", conflict: false });
  assert.deepEqual(deductibleTarget(null, null), { limit: null, source: null, conflict: false });
  // family-only SBC deductible (individual null): individual target intentionally stays null/EOB-sourced
  assert.deepEqual(deductibleTarget({ deductible: { individual: null, family: 3000 } }, { deductibleLimit: 1500 }),
    { limit: 1500, source: "eob", conflict: false });
});

test("planYearStartMonthFrom: extracts month, defaults to 1", () => {
  assert.equal(planYearStartMonthFrom("2026-07-01"), 7);
  assert.equal(planYearStartMonthFrom(null), 1);
  assert.equal(planYearStartMonthFrom("garbage"), 1);
});
```

- [ ] **Step 2: Run to verify failure** — `cd functions && node --test test/plan.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/js/plan.js`**

```js
// Pure plan (SBC) logic. No DOM, no globals — unit-testable in Node.
// All dates are ISO YYYY-MM-DD strings; lexical comparison is date comparison.

export function planApplies(serviceDates, structured) {
  if (!structured || !structured.planYearStart || !structured.planYearEnd) {
    return { applies: false, reason: "no_plan" };
  }
  const dates = (serviceDates || []).filter(Boolean);
  if (!dates.length) return { applies: false, reason: "no_dates" };
  const inWin = dates.some((d) => d >= structured.planYearStart && d <= structured.planYearEnd);
  return inWin ? { applies: true, reason: null } : { applies: false, reason: "out_of_period" };
}

const norm = (c) => String(c).trim().toUpperCase();

// SBC-derived limits become trackers, but never at a manual tracker's expense:
// overlap with a manual tracker blocks creation; overlap with an sbc-sourced
// tracker updates it in place (re-uploads refresh their own trackers only).
export function mergeSbcTrackers(existing, limits, planYearStartMonth) {
  const create = [], update = [];
  const pendingCodes = new Set(); // codes already claimed by a create/update this run
  for (const lim of limits || []) {
    const codes = (lim.codesHint || []).filter(Boolean);
    if (!codes.length || !Number.isFinite(lim.visitsPerYear) || lim.visitsPerYear < 1) continue;
    const codeSet = new Set(codes.map(norm));
    if ([...codeSet].some((c) => pendingCodes.has(c))) continue; // two SBC rows sharing a code → first wins
    const overlap = (t) => (t.codes || []).some((c) => codeSet.has(norm(c)));
    const manualHit = existing.find((t) => t.source !== "sbc" && overlap(t));
    if (manualHit) continue;
    for (const c of codeSet) pendingCodes.add(c);
    const sbcHit = existing.find((t) => t.source === "sbc" && overlap(t));
    if (sbcHit) {
      update.push({ id: sbcHit.id, changes: { label: lim.label, codes, limit: lim.visitsPerYear } });
    } else {
      create.push({ label: lim.label, codes, limit: lim.visitsPerYear, planYearStartMonth, source: "sbc" });
    }
  }
  return { create, update };
}

// The SBC owns the deductible LIMIT; the EOB owns progress. When both state a
// limit and disagree by more than $1, surface the conflict (UI shows both).
export function deductibleTarget(structured, snapshot) {
  const sbcLimit = typeof structured?.deductible?.individual === "number" ? structured.deductible.individual : null;
  const eobLimit = typeof snapshot?.deductibleLimit === "number" ? snapshot.deductibleLimit : null;
  if (sbcLimit !== null) {
    return { limit: sbcLimit, source: "sbc", conflict: eobLimit !== null && Math.abs(eobLimit - sbcLimit) > 1 };
  }
  if (eobLimit !== null) return { limit: eobLimit, source: "eob", conflict: false };
  return { limit: null, source: null, conflict: false };
}

export function planYearStartMonthFrom(planYearStart) {
  const m = Number(String(planYearStart || "").split("-")[1]);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}
```

- [ ] **Step 4: Run tests** — `cd functions && node --test test/plan.test.js`. Expected: PASS. Then full `npm test`.

- [ ] **Step 5: Commit** — `feat(plan): pure client logic — applicability, tracker merge, deductible precedence`

---

### Task 3: Server pure logic — `functions/plan.js` (schema, digest, replace decision, prompts)

**Files:**
- Create: `functions/plan.js`
- Test: `functions/test/plan.test.js` (append)

**Interfaces:**
- Produces (consumed by Tasks 4–5):
  - `planSchema` — Ajv/Gemini responseSchema for the structured plan object (shape exactly as the spec's Data model section).
  - `buildDigest(structured) -> string` — deterministic, ≤2000 chars.
  - `replaceDecision(existingStructured|null, incomingStructured, force: boolean) -> "store"|"confirm_older"`
  - `applyPlanGate(result, structured|null) -> {planApplied: boolean, planReason: null|"no_plan"|"no_dates"|"out_of_period", result}` — post-response applicability gate; strips straggler plan findings and clamps `totals.totalAtStake` when the plan doesn't apply.
  - `PLAN_EXTRACT_INSTRUCTIONS` — the extraction prompt string.
  - `planTermsBlock(digest: string) -> string` — the fenced block appended to the audit prompt.

- [ ] **Step 1: Failing tests** — append to `functions/test/plan.test.js`:

```js
import { planSchema, buildDigest, replaceDecision, planTermsBlock } from "../plan.js";

const STRUCTURED = {
  planName: "Acme Silver PPO", planYearStart: "2026-01-01", planYearEnd: "2026-12-31",
  deductible: { individual: 1500, family: 3000 }, oopMax: { individual: 6000, family: 12000 },
  limits: [{ label: "Outpatient mental health", codesHint: ["90837"], visitsPerYear: 6 }],
  costShares: [{ category: "Rehabilitation services", verbatim: "Rehabilitation services — $60 copay/visit, deductible does not apply", copay: 60, coinsurancePct: null, deductibleApplies: false }],
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

import { applyPlanGate } from "../plan.js";

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

  // clamp: stragglers larger than the stated total never go negative
  r = applyPlanGate(mk(["2025-06-01"], [{ type: "deductible_misapplied", amountAtStake: 999 }], 10), STRUCTURED);
  assert.equal(r.result.totals.totalAtStake, 0);

  // no plan / no dates
  assert.equal(applyPlanGate(mk(["2026-03-01"]), null).planReason, "no_plan");
  assert.equal(applyPlanGate(mk([]), STRUCTURED).planReason, "no_dates");
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `functions/plan.js`**

```js
// Plan (SBC) server-side pure logic: extraction schema + prompt, digest
// builder, and the replace decision. Mirrors schema.js conventions.

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
const nullableBool = { type: ["boolean", "null"] };

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planName", "planYearStart", "planYearEnd", "deductible", "oopMax", "limits", "costShares"],
  properties: {
    planName: nullableString,
    planYearStart: nullableString, // ISO YYYY-MM-DD from the SBC "Coverage Period"
    planYearEnd: nullableString,
    deductible: {
      type: "object", additionalProperties: false, required: ["individual", "family"],
      properties: { individual: nullableNumber, family: nullableNumber },
    },
    oopMax: {
      type: "object", additionalProperties: false, required: ["individual", "family"],
      properties: { individual: nullableNumber, family: nullableNumber },
    },
    limits: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["label", "codesHint", "visitsPerYear"],
        properties: {
          label: { type: "string" },
          codesHint: { type: "array", items: { type: "string" } }, // model-proposed CPT codes; UI flags "check the codes"
          visitsPerYear: nullableNumber,
        },
      },
    },
    costShares: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["category", "verbatim", "copay", "coinsurancePct", "deductibleApplies"],
        properties: {
          category: { type: "string" },
          verbatim: { type: "string" }, // the row copied word-for-word
          copay: nullableNumber,
          coinsurancePct: nullableNumber,
          deductibleApplies: nullableBool,
        },
      },
    },
  },
};

export const PLAN_EXTRACT_INSTRUCTIONS = `You are reading the de-identified text of a Summary of
Benefits and Coverage (SBC) — the standardized ACA document with an "Important Questions" table
and a "Common Medical Events" cost-share grid. Personal identifiers are placeholders like [NAME_1].

Extract, verbatim from the document, NEVER inferred or guessed:
- planName: the marketing/plan name as printed (null if absent).
- planYearStart / planYearEnd: the Coverage Period dates, ISO YYYY-MM-DD (null if absent).
- deductible.individual / .family and oopMax.individual / .family: the printed dollar numbers
  from the Important Questions table (null unless printed as a number).
- limits: every service with a printed visit/day/session-per-year maximum. label = the service
  name as printed; visitsPerYear = the printed number; codesHint = the CPT codes that most
  commonly bill that service, from your medical coding knowledge (this is the ONLY field where
  your knowledge is allowed — everything else must appear in the document).
- costShares: one row per "Common Medical Events" line relevant to outpatient/office/therapy/
  emergency/imaging/lab care. category = the row label as printed; verbatim = the full row text
  word-for-word; copay / coinsurancePct = printed numbers or null; deductibleApplies = true/false
  only when the row states it, else null.

If the document has no Coverage Period AND no Important Questions numbers, it is not an SBC:
return every field null/empty rather than guessing.`;

// Deterministic digest for the audit prompt: key numbers + verbatim rows, hard-capped.
export function buildDigest(structured) {
  const lines = [];
  const money = (n) => (typeof n === "number" ? `$${n}` : "not stated");
  lines.push(`Plan: ${structured.planName || "(name not stated)"} · Coverage ${structured.planYearStart || "?"} to ${structured.planYearEnd || "?"}`);
  lines.push(`Deductible: individual ${money(structured.deductible?.individual)}, family ${money(structured.deductible?.family)}`);
  lines.push(`Out-of-pocket max: individual ${money(structured.oopMax?.individual)}, family ${money(structured.oopMax?.family)}`);
  for (const l of structured.limits || []) {
    lines.push(`Limit: ${l.label} — ${l.visitsPerYear ?? "?"} visits/year`);
  }
  for (const c of structured.costShares || []) {
    lines.push(`Row: ${c.verbatim}`);
  }
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > 2000) break;
    out += (out ? "\n" : "") + line;
  }
  return out;
}

// Older SBC uploads need explicit confirmation; everything else stores.
export function replaceDecision(existing, incoming, force) {
  if (force || !existing) return "store";
  const a = existing.planYearStart, b = incoming.planYearStart;
  if (a && b && b < a) return "confirm_older";
  return "store";
}

// Post-response gate: decide applicability from the audit's own service dates
// and, when the plan does not apply, strip any straggler plan findings the
// model emitted anyway (the prompt date-gates them; this is defense in depth).
const PLAN_FINDING_TYPES = new Set(["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]);

export function applyPlanGate(result, structured) {
  const dates = (result.serviceDates || []).filter(Boolean);
  let planApplied = false, planReason = "no_plan";
  if (structured?.planYearStart && structured?.planYearEnd) {
    if (!dates.length) planReason = "no_dates";
    else if (dates.some((d) => d >= structured.planYearStart && d <= structured.planYearEnd)) {
      planApplied = true; planReason = null;
    } else planReason = "out_of_period";
  }
  if (!planApplied && (result.findings || []).some((f) => PLAN_FINDING_TYPES.has(f.type))) {
    const dropped = result.findings.filter((f) => PLAN_FINDING_TYPES.has(f.type));
    result = {
      ...result,
      findings: result.findings.filter((f) => !PLAN_FINDING_TYPES.has(f.type)),
      totals: {
        ...result.totals,
        totalAtStake: Math.max(0, result.totals.totalAtStake - dropped.reduce((s, f) => s + (f.amountAtStake || 0), 0)),
      },
    };
  }
  return { planApplied, planReason, result };
}

export function planTermsBlock(digest) {
  return `

PLAN TERMS (from the member's Summary of Benefits; quote these verbatim in sbcQuote when citing a mismatch):
---
${digest}
---
Cross-check instructions: compare the bill and EOB lines against the matching plan rows above.
Report copay_mismatch / coinsurance_mismatch / deductible_misapplied / not_covered_per_plan findings
only when the plan term is explicit and the discrepancy is arithmetic, not interpretive. Apply plan
comparisons ONLY to services whose dates fall within the plan's coverage period; if none do, emit no
plan findings. Word not_covered_per_plan findings as "worth asking about", never as a definitive
coverage determination. Every plan finding MUST quote the plan row verbatim in evidence.sbcQuote and
default to "medium" confidence unless the plan row names the exact billed service. Non-plan findings
keep sbcQuote as "".`;
}
```

- [ ] **Step 4: Run tests** — `cd functions && node --test test/plan.test.js` → PASS; then full `npm test`.

- [ ] **Step 5: Commit** — `feat(plan): server plan schema, digest builder, replace decision, prompts`

---

### Task 4: Gemini provider — `runPlanExtract` and plan-aware `runAudit`

**Files:**
- Modify: `functions/providers/gemini.js` (instructions consts at top; `runAudit` body below L56)

**Interfaces:**
- Consumes: `planSchema`, `PLAN_EXTRACT_INSTRUCTIONS`, `planTermsBlock` from `functions/plan.js`.
- Produces: `runPlanExtract(redactedSbc, { modelId, apiKey }) -> structured` (planSchema shape, validated by caller); `runAudit(redactedBill, redactedEob, opts, planDigest = null)` — unchanged behavior when `planDigest` is null.

- [ ] **Step 1: Implement.** (a) Add `import { planSchema, PLAN_EXTRACT_INSTRUCTIONS, planTermsBlock } from "../plan.js";` at the top. (b) Change `runAudit`'s signature and text assembly (currently at L56-80) to:

```js
export async function runAudit(redactedBill, redactedEob, { modelId, apiKey }, planDigest = null) {
  const ai = new GoogleGenAI({ apiKey });
  const eobSection = redactedEob.trim()
    ? `===== EOB =====\n${redactedEob}`
    : BILL_ONLY_NOTE;
  const instructions = AUDIT_INSTRUCTIONS + (planDigest ? planTermsBlock(planDigest) : "");
  const response = await ai.models.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${instructions}\n\n===== ITEMIZED BILL =====\n${redactedBill}\n\n${eobSection}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: findingsSchema,
      temperature: 0,
    },
  });
  return JSON.parse(response.text);
}
```

(c) Add below it:

```js
// Same adapter contract as runAudit: returns the parsed structured plan.
export async function runPlanExtract(redactedSbc, { modelId, apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [{ text: `${PLAN_EXTRACT_INSTRUCTIONS}\n\n===== SUMMARY OF BENEFITS =====\n${redactedSbc}` }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: planSchema,
      temperature: 0,
    },
  });
  return JSON.parse(response.text);
}
```

- [ ] **Step 3: Verify** — `node --check functions/providers/gemini.js` and `cd functions && npm test` (suite must stay green; the live call is exercised in Task 11).

- [ ] **Step 4: Commit** — `feat(gemini): plan extraction call and plan-terms block in the audit prompt`

---

### Task 5: `extractPlan` callable and `analyze` integration — `functions/index.js`

**Files:**
- Modify: `functions/index.js` (new callable after `analyze`; `analyze` body changes at the guards and the `runAudit` call ~L58-98)

**Interfaces:**
- Consumes: `runPlanExtract`, `runAudit(planDigest)`, `planSchema`, `buildDigest`, `replaceDecision` from Tasks 3–4; `planApplies` logic (re-implemented server-side inline, 3 lines — client copy not importable from Functions).
- Produces (client contract for Tasks 8–10):
  - `extractPlan({ redactedSbc: string, sourceName: string, force?: boolean })` returns `{ status: "stored", structured, digest }` or `{ status: "confirm_older", existingPeriod: {start,end}, incomingPeriod: {start,end} }`. Throws `HttpsError`: `unauthenticated`, `invalid-argument` ("The redacted SBC text is required." / "Document too large." / "This doesn't look like a Summary of Benefits."), `resource-exhausted` ("Daily limit of 3 plan uploads reached.").
  - `analyze` response gains `planApplied: boolean` and `planReason: null|"no_plan"|"no_dates"|"out_of_period"`; both are also persisted on the audit doc.

- [ ] **Step 1: Implement `extractPlan`** in `functions/index.js`:

```js
import { planSchema, buildDigest, replaceDecision } from "./plan.js";
import { runPlanExtract } from "./providers/gemini.js";

const PLAN_DAILY_LIMIT = 3;
const validatePlan = ajv.compile(planSchema);

async function checkPlanRateLimit(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/meta/usage`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.planDay === day ? data.planCount || 0 : 0;
    if (count >= PLAN_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", `Daily limit of ${PLAN_DAILY_LIMIT} plan uploads reached.`);
    }
    tx.set(ref, { ...data, planDay: day, planCount: count + 1 }, { merge: true });
  });
}

export const extractPlan = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [GEMINI_API_KEY],
    enforceAppCheck: false, // flip with analyze when App Check is configured
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to add your plan.");
    const uid = request.auth.uid;
    const { redactedSbc, sourceName, force } = request.data || {};
    if (typeof redactedSbc !== "string" || !redactedSbc.trim()) {
      throw new HttpsError("invalid-argument", "The redacted SBC text is required.");
    }
    if (redactedSbc.length > MAX_DOC_CHARS) throw new HttpsError("invalid-argument", "Document too large.");
    await checkPlanRateLimit(uid);

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    let structured;
    try {
      structured = await runPlanExtract(redactedSbc, opts);
      if (!validatePlan(structured)) {
        const errText = ajv.errorsText(validatePlan.errors);
        structured = await runPlanExtract(
          `${redactedSbc}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]`,
          opts
        );
        if (!validatePlan(structured)) {
          throw new HttpsError("internal", "Plan extraction produced invalid output. Please try again.");
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("runPlanExtract failed", { uid, model: MODEL_ID, message: err.message });
      throw new HttpsError("internal", "Plan extraction failed. Please try again.");
    }

    // Not an SBC: no coverage period AND no Important-Questions numbers.
    const hasNumbers = [structured.deductible?.individual, structured.deductible?.family,
      structured.oopMax?.individual, structured.oopMax?.family].some((n) => typeof n === "number");
    if (!structured.planYearStart && !hasNumbers) {
      throw new HttpsError("invalid-argument", "This doesn't look like a Summary of Benefits.");
    }

    const ref = db.doc(`users/${uid}/plan/active`);
    const existing = (await ref.get()).data()?.structured ?? null;
    if (replaceDecision(existing, structured, force === true) === "confirm_older") {
      return {
        status: "confirm_older",
        existingPeriod: { start: existing.planYearStart, end: existing.planYearEnd },
        incomingPeriod: { start: structured.planYearStart, end: structured.planYearEnd },
      };
    }

    const digest = buildDigest(structured);
    await ref.set({
      structured, digest, redactedText: redactedSbc,
      sourceName: typeof sourceName === "string" ? sourceName.slice(0, 200) : "",
      model: MODEL_ID, createdAt: FieldValue.serverTimestamp(),
    });
    return { status: "stored", structured, digest };
  }
);
```

- [ ] **Step 2: Integrate the plan into `analyze`.** Inside the handler, after `checkRateLimit(uid)` and before calling `runAudit`:

```js
    let plan = null;
    try {
      plan = (await db.doc(`users/${uid}/plan/active`).get()).data() ?? null;
    } catch (err) {
      console.error("plan fetch failed — auditing without plan", { uid, message: err.message });
    }
```

Pass the digest into both `runAudit` calls (initial and the validation retry): `runAudit(redactedBill, redactedEob, opts, plan?.digest || null)` — bill-only audits included. After validation succeeds, gate via the tested pure function (import `applyPlanGate` from `./plan.js`):

```js
    const gated = applyPlanGate(result, plan?.structured ?? null);
    result = gated.result;
    const { planApplied, planReason } = gated;
```

Add `planApplied` and `planReason` to the `auditRef.set({...})` payload and to the return object (`return { auditId: auditRef.id, planApplied, planReason, ...result }`).

**Also fix the existing audit rate limiter (bug found in plan review):** `checkRateLimit` currently writes `tx.set(ref, { day, count: count + 1 })` WITHOUT merge — once plan counters live in the same `meta/usage` doc, every audit would wipe `planDay`/`planCount`. Change it to:

```js
    tx.set(ref, { day, count: count + 1 }, { merge: true });
```

(`checkPlanRateLimit` already spreads `...data` and merges; with both merging, the two counters coexist.)

- [ ] **Step 3: Verify** — `node --check functions/index.js`; `cd functions && npm test` stays green.

- [ ] **Step 4: Commit** — `feat(functions): extractPlan callable; analyze cross-checks against the stored plan`

---

### Task 6: Firestore rules for the plan path

**Files:**
- Modify: `firestore.rules` (before the `meta` block)
- Test: `functions/test/rules.test.js` (inside the `else` branch, after the eobs tests)

- [ ] **Step 1: Write the failing rules tests** (they run only under the emulator; keep the existing skip guard untouched):

```js
  // Plan doc: written exclusively by the extractPlan Function (Admin SDK).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/alice/plan/active").set({ structured: {}, digest: "" });
  });
  test("plan: owner can read and delete; nobody can write", async () => {
    await assertSucceeds(alice.doc("users/alice/plan/active").get());
    await assertFails(alice.doc("users/alice/plan/active").set({ structured: {} }));
    await assertFails(mallory.doc("users/alice/plan/active").get());
    await assertFails(anon.doc("users/alice/plan/active").get());
    await assertSucceeds(alice.doc("users/alice/plan/active").delete());
  });
```

- [ ] **Step 2: Run under the emulator to verify failure** — `firebase emulators:exec --only firestore "npm --prefix functions test"`. Expected: the new test FAILS (catch-all denies owner read).

- [ ] **Step 3: Add the rule** to `firestore.rules`, above the `meta` match:

```
    // The active plan (SBC) is written exclusively by the extractPlan Function
    // via the Admin SDK. Clients may only read and delete their own.
    match /users/{uid}/plan/{docId} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create, update: if false;
    }
```

- [ ] **Step 4: Re-run the emulator command** — new test PASSES; plain `npm test` still green (skip path).

- [ ] **Step 5: Commit** — `feat(rules): plan path — owner read/delete, Function sole writer`

---

### Task 7: SBC fixture — generator, HTML, answer key

**Files:**
- Modify: `test-fixtures/gen-series.mjs` (new `sbc()` template + write calls at the bottom where other files are written)

**Interfaces:**
- Produces: `test-fixtures/fake-sbc.html` — Acme Silver PPO SBC. Planted values (consumed by Task 11 verification): deductible $1,500/$3,000 family, OOP max $6,000/$12,000, coverage period 2026-01-01→2026-12-31, limit row "Outpatient mental health services: $0 coinsurance after deductible — limited to 6 visits per plan year", planted mismatch hook "Rehabilitation services (physical, occupational therapy) — $60 copay/visit, deductible does not apply" (contradicts the p1 fixture pair, whose EOB shows $95.00 member responsibility → expected copay_mismatch, ~$35 delta). CORRECTED during execution (Task 7 review): p1's EOB is allowed $95 / responsibility $95 with no deductible applied — the earlier "$120 to deductible" text confused it with the t-series THERAPY object.

- [ ] **Step 1: Add the `sbc()` template** to `gen-series.mjs` (same style as `bill()`/`eob()`):

```js
function sbc() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${css}</head><body>
<div class="head"><div><h1 style="color:#123c78">ACME HEALTH INSURANCE</h1>
<div class="muted">Summary of Benefits and Coverage: What this Plan Covers &amp; What You Pay For Covered Services</div></div>
<div style="text-align:right"><b>Acme Silver PPO</b><br>Coverage Period: 01/01/2026 – 12/31/2026<br>Coverage for: Individual/Family · Plan Type: PPO</div></div>
<div class="box"><b>Member:</b> Jane Q. Testpatient<br><b>Member ID:</b> AHX-55512345</div>
<h1 style="margin-top:14px">Important Questions</h1>
<table>
<tr><th>Question</th><th>Answer</th></tr>
<tr><td>What is the overall deductible?</td><td>$1,500 individual / $3,000 family</td></tr>
<tr><td>What is the out-of-pocket limit for this plan?</td><td>$6,000 individual / $12,000 family</td></tr>
<tr><td>Are there services covered before you meet your deductible?</td><td>Yes. Preventive care and services with a copay are covered before you meet your deductible.</td></tr>
</table>
<h1 style="margin-top:14px">Common Medical Events</h1>
<table>
<tr><th>Medical event</th><th>What you will pay (network)</th><th>Limitations &amp; exceptions</th></tr>
<tr><td>Primary care visit</td><td>$25 copay/visit, deductible does not apply</td><td>none</td></tr>
<tr><td>Specialist visit</td><td>$60 copay/visit, deductible does not apply</td><td>none</td></tr>
<tr><td>Outpatient mental health services</td><td>$0 coinsurance after deductible</td><td>Limited to 6 visits per plan year</td></tr>
<tr><td>Rehabilitation services (physical, occupational therapy)</td><td>$60 copay/visit, deductible does not apply</td><td>Limited to 20 visits per plan year</td></tr>
<tr><td>Emergency room care</td><td>20% coinsurance after deductible</td><td>Copay waived if admitted</td></tr>
<tr><td>Diagnostic test (x-ray, blood work)</td><td>10% coinsurance after deductible</td><td>none</td></tr>
</table>
<div class="note">This is a synthetic test fixture. Jane Q. Testpatient is a canary identity.</div>
</body></html>`;
}
```

- [ ] **Step 2: Write the file + answer key.** Where `gen-series.mjs` writes its outputs, add: `writeFileSync(new URL("./fake-sbc.html", import.meta.url).pathname, sbc());` and extend the answer key it writes (`series-expected.json`) with:

```js
  sbc: {
    file: "fake-sbc.html",
    deductible: { individual: 1500, family: 3000 },
    oopMax: { individual: 6000, family: 12000 },
    period: ["2026-01-01", "2026-12-31"],
    limits: [
      { label: "Outpatient mental health services", visitsPerYear: 6 },
      { label: "Rehabilitation services (physical, occupational therapy)", visitsPerYear: 20 },
    ],
    plantedMismatch: { pairsWith: "p1", expectTypes: ["copay_mismatch", "deductible_misapplied"], planted: "$60 copay/visit vs $120 applied to deductible" },
  },
```

(Read the bottom of `gen-series.mjs` first and match however the existing expected-key object is assembled.)

- [ ] **Step 3: Generate and verify** — `cd test-fixtures && node gen-series.mjs`, then confirm: `grep -c "Coverage Period: 01/01/2026" fake-sbc.html` → 1, `grep -c '"sbc"' series-expected.json` → ≥1, and `git diff --stat` shows only intended files (existing series HTML is regenerated byte-identical).

- [ ] **Step 4: Commit** — `test(fixtures): fake-sbc — Acme Silver PPO SBC with planted PT copay mismatch`
(PDF render of fake-sbc.html via the browse CLI is done manually alongside Task 11, matching how other fixture PDFs are produced.)

---

### Task 8: UI — "Your plan" card, SBC upload flow, freshness handling

**Files:**
- Modify: `web/app.html` (Coverage usage section ~L215; style block)
- Modify: `web/js/app.js` (imports; plan state + `loadPlan()`; SBC upload/review/confirm path; callable)

**Interfaces:**
- Consumes: `extractPlan` callable contract (Task 5); `planYearStartMonthFrom`, `mergeSbcTrackers` (Task 2 — merge applied in Task 10).
- Produces: `let activePlan = null` (the fetched plan doc) and `loadPlan()`; `renderPlanCard()`; state flag `state.sbcFlow = true` marking the review screen as an SBC review. Task 9/10 read `activePlan`.

- [ ] **Step 1: Markup.** In `web/app.html`, directly under `<h2>Coverage usage</h2>` (and its intro `<p class="muted">`), add:

```html
    <div id="plan-card"></div>
```

Then add to the style block (after `.usage-del`):

```css
  .plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:10px}
  .plan-grid .pg-label{font-size:12px;color:var(--ink-soft)}
  .plan-grid .pg-value{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-variant-numeric:tabular-nums}
  .plan-top{border-top:3px solid var(--brand)}
  .plan-period{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--ink-soft)}
  .plan-actions{display:flex;gap:12px;justify-content:flex-end;align-items:center;margin-top:12px}
  .plan-actions a{font-size:13px}
  .dz.dz-sm{padding:18px 16px}
```

- [ ] **Step 2: Client plan state + render.** In `web/js/app.js`, add near the other imports `import { planYearStartMonthFrom, mergeSbcTrackers, deductibleTarget } from "./plan.js";` (`planApplies` is server-side only — do not import it), and near `analyzeFn`: `const extractPlanFn = httpsCallable(functions, "extractPlan", { timeout: 300_000 });`. Add after the saved-EOB section:

```js
// ---------- Your plan (SBC) ----------

let activePlan = null; // {structured, digest, redactedText, sourceName, createdAt}

async function loadPlan() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDoc(doc(db, `users/${user.uid}/plan/active`));
  activePlan = snap.exists() ? snap.data() : null;
  renderPlanCard();
}

function renderPlanCard() {
  const el = $("plan-card");
  const s = activePlan?.structured;
  if (!s) {
    el.innerHTML = `<div class="usage-card plan-top">
      <b>Add your Summary of Benefits — we'll set up your deductible and visit limits automatically.</b>
      <label class="dz dz-sm" id="dz-sbc" style="margin-top:10px">
        <b>Summary of Benefits (SBC)</b>
        <div class="hint">Drop it here or click to choose · PDF or photo<br>This is about your plan — not a bill or EOB</div>
        <input id="sbc-file" type="file" accept="application/pdf,image/*,text/html,.html,.htm,text/plain,.txt">
      </label>
      <details class="explain" style="margin-top:10px"><summary>What's an SBC, and where do I find it?</summary>
        <p>A standard 4–8 page document every plan must provide — a grid of what you pay per visit type.
        Find it: your insurer's website → your plan → “Summary of Benefits and Coverage” (PDF);
        your enrollment packet or open-enrollment email; or ask HR.</p>
      </details>
    </div>`;
  } else {
    const fmtd = (n) => (typeof n === "number" ? fmt(n) : "—");
    const expired = s.planYearEnd && todayISO() > s.planYearEnd;
    el.innerHTML = `<div class="usage-card plan-top">
      <div class="usage-head"><b>${escapeHtml(s.planName || "Your plan")}</b>
        <span class="plan-period">${escapeHtml(s.planYearStart || "?")} → ${escapeHtml(s.planYearEnd || "?")}</span></div>
      ${expired ? `<div class="banner" style="margin:10px 0 0">Your plan year ended ${escapeHtml(s.planYearEnd)} — upload your new SBC.</div>` : ""}
      <div class="plan-grid">
        <div><div class="pg-label">Deductible</div><div class="pg-value">${fmtd(s.deductible?.individual)}</div></div>
        <div><div class="pg-label">Out-of-pocket max</div><div class="pg-value">${fmtd(s.oopMax?.individual)}</div></div>
        ${(s.limits || []).map((l) => `<div><div class="pg-label">${escapeHtml(l.label)}</div><div class="pg-value">${l.visitsPerYear ?? "—"}/yr</div></div>`).join("")}
      </div>
      <div class="plan-actions">
        <a href="#" id="plan-view">View full plan</a>
        <label class="btn ghost sm" style="margin:0">Replace<input id="sbc-file" type="file" hidden accept="application/pdf,image/*,text/html,.html,.htm,text/plain,.txt"></label>
      </div>
    </div>`;
    $("plan-view").onclick = (e) => {
      e.preventDefault();
      alert(activePlan.redactedText ? activePlan.redactedText.slice(0, 4000) : "No stored text.");
    };
  }
  const input = $("sbc-file");
  if (input) input.onchange = () => { if (input.files[0]) prepareSbc(input.files[0]); input.value = ""; };
  const dz = $("dz-sbc");
  if (dz) {
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault(); dz.classList.remove("drag");
      if (e.dataTransfer.files[0]) prepareSbc(e.dataTransfer.files[0]);
    });
  }
}
```

Note: `getDoc` must be added to the existing firebase-firestore import list. `View full plan` uses a plain `alert` ONLY if the codebase has no modal pattern — check first; if `#email-card`-style card exists, prefer a hidden card. (Check: the app has no modal pattern; a dedicated hidden `.card` below plan-card showing `<pre>` text is the better fit — implement that instead of `alert`: a `<div id="plan-full" class="card" hidden><pre></pre></div>` toggled by the link.)

- [ ] **Step 3: SBC upload → redact → review → extractPlan.** Add after `prepareAudit`:

```js
async function prepareSbc(file) {
  if (file.size > 20e6) return setError("upload-error", "Files must be under 20MB.");
  resetStatePreservingFiles();
  state.sbcFlow = true;
  show("processing");
  try {
    setStatus("Reading your Summary of Benefits…");
    const ex = await extractText(file);
    // Free duplicate check happens after redaction (compare redacted text).
    setStatus("Loading the privacy model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) setStatus(`Downloading privacy model… ${Math.round((p.loaded / p.total) * 100)}%`);
    });
    setStatus("Hiding your personal information — on your device…");
    state.bill = { originalText: ex.text, previews: ex.previews, method: ex.method, confidence: ex.confidence };
    state.bill.redacted = (await deidentify(ex.text, ner, state.registry)).redacted;
    state.sbcName = file.name;
    if (activePlan && activePlan.redactedText === state.bill.redacted) {
      show("upload");
      return setError("upload-error", "This plan is already on file.");
    }
    $("ocr-banner").hidden = ex.method !== "ocr";
    state.activeDoc = "bill";
    $("tab-eob").style.display = "none";
    $("save-eob-wrap").hidden = true;
    setBatchLabels("Reviewing your Summary of Benefits — plan documents contain little personal info, but check anyway.");
    renderReview();
    show("review");
  } catch (e) {
    console.error(e);
    setError("upload-error", `Could not process the document: ${e.message}`);
    show("upload");
  }
}

async function runSbcExtraction(force = false) {
  const redactedSbc = state.bill.redacted;
  const sourceName = state.sbcName || "";
  state.bill.originalText = null; state.bill.previews = null;
  $("original-pane").textContent = "";
  show("processing");
  setStatus("Reading your plan's terms…");
  try {
    const { data } = await extractPlanFn({ redactedSbc, sourceName, force });
    if (data.status === "confirm_older") {
      const msg = `The plan on file covers ${data.existingPeriod.start} → ${data.existingPeriod.end}; ` +
        `this document covers ${data.incomingPeriod.start} → ${data.incomingPeriod.end}. Replace anyway?`;
      if (confirm(msg)) return runSbcExtraction(true);
      show("upload"); setBatchLabels(null); return;
    }
    await loadPlan();
    await applySbcConfiguration(); // Task 10
    setBatchLabels(null);
    show("upload");
    track("plan_added");
    $("plan-card").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
    setError("upload-error", e.code === "functions/resource-exhausted" || e.code === "functions/invalid-argument"
      ? e.message : "Plan extraction failed — please try again.");
    show("upload"); setBatchLabels(null);
  }
}
```

Wire the review confirm: at the top of the `confirm-review` handler, before the batch branch, add `if (state.sbcFlow) return runSbcExtraction();`. Expired-SBC handling: the plan is stored and the renewal banner in `renderPlanCard` shows immediately after upload — a conscious simplification of the spec's pre-store "Keep anyway?" confirm (extraction must complete before the coverage period is known; a store-then-banner keeps the flow one-step and the user equally informed). `state.sbcFlow` is naturally cleared because `resetStatePreservingFiles` rebuilds the state object — verify it stays that way.

- [ ] **Step 4: Call `loadPlan()`** wherever `loadEobs()`/`loadHistory()` run at sign-in (find the auth-ready block that calls them; add `loadPlan()` alongside).

- [ ] **Step 5: Verify** — `node --check web/js/app.js`; `cd functions && npm test` green. Manual check deferred to Task 11.

- [ ] **Step 6: Commit** — `feat(ui): Your plan card and SBC upload flow with freshness handling`

---

### Task 9: UI — plan findings rendering and the "not checked" footer

**Files:**
- Modify: `web/js/app.js` (`TYPE_LABELS` map; `renderReport` ~L549-590; confirm-review + runBatch call sites of `renderReport`)
- Modify: `web/app.html` (report section: add `<p id="plan-note" class="muted" style="font-size:13px" hidden></p>` between `#report-occurrences`' heading block and the disclaimer; style block: `.xq`/`.src`/`mark` rules)

**Interfaces:**
- Consumes: finding shape with `evidence.sbcQuote` (Task 1); `planApplied`/`planReason` on the analyze response (Task 5); `activePlan` (Task 8).
- Produces: `renderReport(data, { ocrLow, model, planApplied, planReason })` — extended options consumed by both single and batch flows.

- [ ] **Step 1: CSS.** Add to `web/app.html` styles (near `.finding`):

```css
  .xq{font-family:ui-monospace,Menlo,monospace;font-size:13px;border-left:3px solid var(--brand);padding-left:10px;margin:6px 0}
  .xq .src{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-soft);margin-right:8px}
  mark{background:#E8F25C;color:var(--ink);padding:1px 4px;border-radius:3px}
```

- [ ] **Step 2: Labels + rendering.** In `web/js/app.js` extend `TYPE_LABELS` with:

```js
  copay_mismatch: "Copay doesn't match your plan",
  coinsurance_mismatch: "Coinsurance math doesn't match",
  deductible_misapplied: "Deductible applied where plan says none",
  not_covered_per_plan: "Coverage question worth asking",
```

In `renderReport`, define `const PLAN_TYPES = new Set(["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]);` and change the per-finding template: plan findings render open evidence (`.xq` rows + marked delta), others keep the existing `<details>`:

```js
        ${list.map((f) => PLAN_TYPES.has(f.type) ? `
          <div class="finding ${f.confidence}">
            <div class="f-head"><b>${fmt(f.amountAtStake)}</b><span class="conf">${f.confidence} confidence</span></div>
            <div class="xq"><span class="src">SBC</span>“${escapeHtml(f.evidence.sbcQuote)}”</div>
            <div class="xq"><span class="src">${f.evidence.billQuote ? "Bill" : "EOB"}</span>“${escapeHtml(f.evidence.billQuote || f.evidence.eobQuote)}”</div>
            <p>${escapeHtml(f.description)} — <mark>${fmt(f.amountAtStake)} you may not owe</mark>.</p>
            <p class="lineref">${escapeHtml(f.lineRef)}</p>
          </div>` : `
          <div class="finding ${f.confidence}">
            <div class="f-head"><b>${fmt(f.amountAtStake)}</b><span class="conf">${f.confidence} confidence</span></div>
            <p>${escapeHtml(f.description)}</p>
            <details><summary>Evidence</summary>
              <p><b>Bill:</b> “${escapeHtml(f.evidence.billQuote)}”</p>
              ${f.evidence.eobQuote ? `<p><b>EOB:</b> “${escapeHtml(f.evidence.eobQuote)}”</p>` : ""}
              <p class="lineref">${escapeHtml(f.lineRef)}</p>
            </details>
          </div>`).join("")}
```

(The else branch is the existing template character-for-character — only the plan branch is new.)

- [ ] **Step 3: The footer note.** At the end of `renderReport`, accept the new options and set:

```js
  const note = $("plan-note");
  if (planApplied === false && planReason) {
    note.hidden = false;
    note.innerHTML = planReason === "no_plan"
      ? `Not checked against your plan — add your Summary of Benefits under Coverage usage to enable plan checks.`
      : planReason === "out_of_period"
        ? `Not checked against your plan — this bill's service dates fall outside your plan year${activePlan?.structured?.planYearEnd ? ` (ended ${escapeHtml(activePlan.structured.planYearEnd)})` : ""}.`
        : `Not checked against your plan — no service dates could be read from this bill.`;
  } else { note.hidden = true; note.innerHTML = ""; }
```

Update both call sites to pass through: in the single-audit confirm handler `renderReport(data, { ocrLow, model: data.model, planApplied: data.planApplied, planReason: data.planReason })`, and in `runBatch` likewise from `last.data`. Also update the disclaimer paragraph in `web/app.html` with one added sentence: `Plan-comparison findings are based on automated reading of your Summary of Benefits and may not reflect your plan's full terms.`

- [ ] **Step 4: Verify** — `node --check web/js/app.js`; `npm test` green.

- [ ] **Step 5: Commit** — `feat(ui): plan-mismatch findings with quoted cross-reference and not-checked footer`

---

### Task 10: Auto-configuration — trackers from SBC limits, deductible precedence

**Files:**
- Modify: `web/js/app.js` (new `applySbcConfiguration()` near the tracker code; deductible card block ~L853-866; tracker card render for the sbc tag)

**Interfaces:**
- Consumes: `mergeSbcTrackers`, `planYearStartMonthFrom`, `deductibleTarget` (Task 2); `activePlan` (Task 8); `allTrackers`, `loadTrackers()`, `renderUsage()`, `latestAccumulators` (existing).
- Produces: `applySbcConfiguration()` called by `runSbcExtraction` (Task 8 already calls it).

- [ ] **Step 1: Implement `applySbcConfiguration`:**

```js
// After a successful SBC extraction: create/update sbc-sourced trackers.
async function applySbcConfiguration() {
  const s = activePlan?.structured;
  if (!s) return;
  const month = planYearStartMonthFrom(s.planYearStart);
  const { create, update } = mergeSbcTrackers(allTrackers, s.limits || [], month);
  const uid = auth.currentUser.uid;
  for (const t of create) {
    await addDoc(collection(db, `users/${uid}/trackers`), { ...t, createdAt: serverTimestamp() });
  }
  for (const u of update) {
    await updateDoc(doc(db, `users/${uid}/trackers/${u.id}`), u.changes);
  }
  if (create.length || update.length) { await loadTrackers(); }
  renderUsage();
}
```

(`updateDoc` must be added to the firestore import list if absent.)

- [ ] **Step 2: The "check the codes" tag.** In the tracker card render inside `renderUsage`, where the tracker label is written, append for sbc-sourced untouched trackers: `${t.source === "sbc" && !t.confirmed ? ' <span class="count" title="Codes were suggested from your SBC — open the tracker and confirm them">from your SBC — check the codes</span>' : ""}`. Mark confirmed on first user interaction: in the tracker delete/edit handlers and the existing per-card expand `<details>` toggle, set `{ confirmed: true }` via `updateDoc` the first time a user opens an sbc tracker's details (one `ontoggle` listener on the card's `<details>`).

- [ ] **Step 3: Deductible precedence.** Replace the deductible card's limit derivation: compute `const target = deductibleTarget(activePlan?.structured ?? null, snapshot);` then render the card when `snapshot?.deductibleToDate` is a number OR (`target.limit !== null` — SBC-only state shows `$0 of $X` progress from `summedApplied ?? 0`). The limit text uses `target.limit`; the sourcing line becomes: `As stated on your most recent EOB (${asOf})` when source is "eob", `Target from your plan (SBC)` when "sbc" with no snapshot, or both when snapshot exists and source is "sbc". When `target.conflict`, append: `Note: your EOB states a different annual deductible (${fmt(snapshot.deductibleLimit)}) than your SBC (${fmt(target.limit)}) — worth a look.` Keep the existing per-claim `disagreement` line unchanged.

- [ ] **Step 4: Verify** — `node --check web/js/app.js`; full `npm test` green (the pure merge/target logic is already covered by Task 2 tests).

- [ ] **Step 5: Commit** — `feat(ui): SBC auto-configures trackers and deductible target with precedence rules`

---

### Task 11: Deploy, live fixture verification, graph update

**Files:** none created — deployment and verification.

- [ ] **Step 1: Deploy** — `firebase deploy --only functions,firestore:rules,hosting` from the repo root (functions deploy needs the GEMINI_API_KEY secret already configured — it is).

- [ ] **Step 2: Render the fixture PDF** (matching other fixtures): use the browse CLI per `docs/SETUP.md` to print `test-fixtures/fake-sbc.html` to `test-fixtures/fake-sbc.pdf`.

- [ ] **Step 3: Live verification** (consumes 2 audits + 1 plan upload of the daily limits; DB was wiped 2026-08-08 so counters are fresh) — hard-refresh useclaimright.web.app/app, then:
  1. Upload `fake-sbc.pdf` via the "Your plan" card → review screen shows the SBC once → confirm → plan card renders "Acme Silver PPO · 2026-01-01 → 2026-12-31", deductible $1,500, OOP $6,000, limits 6/yr and 20/yr; two trackers appear tagged "from your SBC — check the codes"; deductible card shows "$0 of $1,500 · Target from your plan (SBC)".
  2. Re-upload the same `fake-sbc.pdf` → "This plan is already on file." with no Function call charged (verify `planCount` unchanged is optional).
  3. Audit `p1-bill.pdf` + `p1-eob.pdf` → report contains a plan finding (copay_mismatch and/or deductible_misapplied) quoting "Rehabilitation services — $60 copay/visit, deductible does not apply" with the delta marked in highlighter; no "not checked" footer.
  4. Audit `t1-bill.pdf` + `t1-eob.pdf` → NO false plan mismatch (mental-health row is consistent with the EOB's deductible treatment); the mental-health tracker counts the visit.
- [ ] **Step 4: Update the graph** — `graphify update .` from the repo root (verify `pwd` first).
- [ ] **Step 5: Final commit** of any verification-driven fixes; report results against `series-expected.json`'s `sbc` entry.
