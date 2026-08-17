import { test } from "node:test";
import assert from "node:assert/strict";
import { addUsage, estimateCostUsd, PRICING } from "../cost.js";

test("a typical audit's cost, at the rates in PRICING", () => {
  // Fixture-sized run: instructions + schema + bill + EOB in, findings out.
  const usd = estimateCostUsd({ input: 2600, output: 1000 }, "gemini-3.6-flash");
  assert.equal(Number(usd.toFixed(6)), 0.005700); // 2600*0.75/1e6 + 1000*3.75/1e6
});

test("output dominates: doubling output costs more than doubling input", () => {
  const base = estimateCostUsd({ input: 2000, output: 1000 }, "gemini-3.6-flash");
  const moreIn = estimateCostUsd({ input: 4000, output: 1000 }, "gemini-3.6-flash");
  const moreOut = estimateCostUsd({ input: 2000, output: 2000 }, "gemini-3.6-flash");
  assert.ok(moreOut - base > moreIn - base);
});

test("an unpriced model or missing counts yields null, never a guess", () => {
  assert.equal(estimateCostUsd({ input: 100, output: 10 }, "some-future-model"), null);
  assert.equal(estimateCostUsd({ input: null, output: null }, "gemini-3.6-flash"), null);
  assert.equal(estimateCostUsd(undefined, "gemini-3.6-flash"), null);
});

test("addUsage sums calls so a validation retry is visible", () => {
  const first = { input: 2600, output: 900, total: 3500, calls: 1 };
  const merged = addUsage(first, { input: 2700, output: 950, total: 3650 });
  assert.deepEqual(merged, { input: 5300, output: 1850, total: 7150, calls: 2 });
});

test("addUsage keeps null when a provider reports nothing", () => {
  assert.deepEqual(addUsage(null, { input: null, output: null, total: null }),
    { input: null, output: null, total: null, calls: 1 });
});

test("every priced model has both rates", () => {
  for (const [model, rate] of Object.entries(PRICING)) {
    assert.equal(typeof rate.input, "number", `${model} input`);
    assert.equal(typeof rate.output, "number", `${model} output`);
  }
});
