// What a model call actually cost. Token counts are the durable record — they
// are stored on the audit; the dollar figure is derived, because published
// rates change (gemini-3.6-flash doubles on 2027-01-01) and a number frozen
// into a document would quietly become a lie.

// USD per 1,000,000 tokens. Update when Google's price list changes.
export const PRICING = {
  // Standard pricing through 2026-12-31; $1.50 / $7.50 from 2027-01-01.
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

// Sum several calls into one usage figure. A schema-validation retry means an
// audit bills twice, so `calls` is tracked: an audit whose calls > 1 cost
// double, and that is worth being able to see.
export function addUsage(a, b) {
  const num = (x, y) => (typeof x === "number" || typeof y === "number" ? (x || 0) + (y || 0) : null);
  return {
    input: num(a?.input, b?.input),
    output: num(a?.output, b?.output),
    total: num(a?.total, b?.total),
    calls: (a?.calls || 0) + (b?.calls ?? 1),
  };
}

// Null when the model is unpriced or the provider reported no counts — better
// an absent number than a confidently wrong one.
export function estimateCostUsd(usage, modelId, pricing = PRICING) {
  const rate = pricing[modelId];
  if (!rate || typeof usage?.input !== "number" || typeof usage?.output !== "number") return null;
  return (usage.input * rate.input + usage.output * rate.output) / 1e6;
}
