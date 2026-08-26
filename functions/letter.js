// The appeal letter.
//
// This lives on the server for one reason: it is the thing there is any
// prospect of charging for, and you cannot paywall code that runs in the
// browser. While `buildDisputeEmail` was a function in app.js, hiding the
// button behind an entitlement was theatre — devtools calls it directly, and
// the findings are already rendered on the page anyway.
//
// It costs nothing to produce. There is no model call here: every figure and
// quote was computed when the audit ran and is read back out of Firestore. That
// shapes the business — the expensive thing (the audit) is the free one, and
// the free-to-produce thing is the one with a price on it.

const TYPE_LABELS = {
  duplicate_charge: "Duplicate charge",
  unbundling: "Unbundled charges",
  wrong_code: "Code / description mismatch",
  billed_vs_allowed_mismatch: "Billed above EOB allowed amount",
  not_in_eob: "On the bill, missing from the EOB",
  cost_share_error: "Cost-sharing math error",
  charity_care_eligible: "Financial assistance may apply",
  copay_mismatch: "Copay doesn't match your plan",
  coinsurance_mismatch: "Coinsurance math doesn't match",
  deductible_misapplied: "Deductible applied where plan says none",
  not_covered_per_plan: "Coverage question worth asking",
};

// Findings that are the INSURER's arithmetic, not the provider's billing. A
// letter about only these should go to the plan, because the provider cannot
// fix them.
const INSURER_ONLY_TYPES = new Set(["cost_share_error"]);

const fmt = (n) =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

export const NOTHING_TO_DISPUTE =
  "Good news — this audit found no discrepancies between the bill and the EOB, so there's nothing to dispute.";

export function buildDisputeLetter({ findings, totals }) {
  findings = findings || [];
  totals = totals || {};
  if (!findings.length) return NOTHING_TO_DISPUTE;

  const insurerOnly = findings.every((f) => INSURER_ONLY_TYPES.has(f.type));
  const to = insurerOnly
    ? "[YOUR INSURANCE COMPANY] Member Services"
    : "[PROVIDER NAME] Billing Department";
  const lines = [];
  lines.push(`To: ${to}`);
  lines.push(`From: [YOUR NAME]`);
  lines.push(`Re: Billing review request — Account [YOUR ACCOUNT NUMBER], date of service [DATE OF SERVICE]`);
  lines.push("");
  lines.push("To whom it may concern,");
  lines.push("");
  lines.push(
    "I have reviewed my itemized bill against the Explanation of Benefits (EOB) issued by my insurance " +
    "plan for this claim, and I identified the following discrepancies. I am requesting a written, " +
    "line-by-line review and a corrected statement before making further payment."
  );
  findings.forEach((f, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${TYPE_LABELS[f.type] || f.type} — amount in question: ${fmt(f.amountAtStake)}`);
    lines.push(`   ${f.description}`);
    if (f.evidence?.billQuote) lines.push(`   Bill states: "${f.evidence.billQuote}"`);
    if (f.evidence?.eobQuote) lines.push(`   EOB states: "${f.evidence.eobQuote}"`);
    if (f.evidence?.sbcQuote) lines.push(`   My plan (SBC) states: "${f.evidence.sbcQuote}"`);
  });
  lines.push("");
  if (findings.some((f) => f.type === "billed_vs_allowed_mismatch")) {
    lines.push(
      `Per the EOB, my total member responsibility for this claim is ${fmt(totals.patientResponsibility)}. ` +
      "If this provider participates in my plan's network, amounts above the plan's allowed amount are " +
      "contractual write-offs and may not be billed to me. Please confirm this provider's network status " +
      "for the date of service and adjust the balance accordingly."
    );
    lines.push("");
  }
  lines.push("Please:");
  lines.push("  1. Provide a written response and an itemized, corrected statement within 30 days;");
  lines.push("  2. Place any disputed balance on hold and refrain from collections activity while this review is pending.");
  lines.push("");
  lines.push("Thank you,");
  lines.push("[YOUR NAME]");
  lines.push("[YOUR PHONE] · [YOUR EMAIL]");
  lines.push("");
  lines.push("— Prepared with the help of UseClaimRight (self-help tool; not legal advice).");
  return lines.join("\n");
}
