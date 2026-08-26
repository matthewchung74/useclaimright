// Payments: entitlement bookkeeping, kept separate from the Stripe SDK so the
// rules that decide who gets a letter are unit-testable without a network.
//
// The product is ONE appeal letter. Not a subscription: someone disputing a
// hospital bill has an acute problem, not a recurring one, and a subscription
// for a once-a-year event churns immediately and generates refunds.

// Priced at $4.99 rather than $1.99 because Stripe's fixed 30¢ dominates a small
// one-off: at $1.99 the fee is 18% of the price, at $4.99 it is 8.9%. One letter
// funds roughly 450 free audits at ~$0.01 of Gemini each. Change this and the
// name together — both are shown to the buyer on Stripe's hosted page.
export const LETTER_PRICE_CENTS = 499;
export const LETTER_PRODUCT_NAME = "UseClaimRight appeal letter";
export const CURRENCY = "usd";

// One purchase grants one letter. Letters already paid for stay unlocked
// forever: the buyer paid for THAT letter, and re-opening an audit they already
// bought must not charge them twice.
export const entitlementsPath = (uid) => `users/${uid}/meta/entitlements`;

// Is this audit's letter already paid for, or is there an unspent credit?
//
// Returns why, not just yes/no, because the caller shows different UI for
// "you already bought this" and "you have a credit to spend".
export function letterAccess(entitlements, auditId) {
  const e = entitlements || {};
  const unlocked = Array.isArray(e.unlockedAudits) ? e.unlockedAudits : [];
  if (auditId && unlocked.includes(auditId)) return { allowed: true, reason: "already_purchased" };
  if ((e.letterCredits || 0) > 0) return { allowed: true, reason: "credit_available" };
  return { allowed: false, reason: "payment_required" };
}

// Spending a credit on an audit is what makes it permanently unlocked. Called
// inside a transaction by the caller.
//
// Re-unlocking an audit that is already unlocked must NOT spend a second
// credit — that is the double-charge, and it is the failure a member would
// rightly be angry about.
export function spendCredit(entitlements, auditId) {
  const e = entitlements || {};
  const unlocked = Array.isArray(e.unlockedAudits) ? e.unlockedAudits : [];
  if (unlocked.includes(auditId)) return { changed: false, next: e };
  const credits = e.letterCredits || 0;
  if (credits <= 0) return { changed: false, next: e };
  return {
    changed: true,
    next: { ...e, letterCredits: credits - 1, unlockedAudits: [...unlocked, auditId] },
  };
}

// Granting is deliberately additive and idempotent on the Stripe event id.
// Stripe retries any non-2xx, and will re-deliver an event it already delivered
// if the response was slow — without this a single payment grants two credits.
export function grantCredits(entitlements, { eventId, credits = 1 }) {
  const e = entitlements || {};
  const seen = Array.isArray(e.stripeEvents) ? e.stripeEvents : [];
  if (eventId && seen.includes(eventId)) return { changed: false, next: e };
  return {
    changed: true,
    next: {
      ...e,
      letterCredits: (e.letterCredits || 0) + credits,
      // Bounded: this is a replay guard, not an audit log. The last 50 event ids
      // is far more than Stripe's retry window, and keeps the document small.
      stripeEvents: [...seen, eventId].filter(Boolean).slice(-50),
    },
  };
}
