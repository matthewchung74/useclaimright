# Stripe

**Status 2026-08-26: built and deployed, switched OFF.** The letter is server-side and still
free; `createCheckoutSession`, `stripeWebhook` and the entitlement gate are all live but inert
behind `PAYMENTS=on`, which is not set. Turning it on needs real Stripe keys — see §7.

The decision this rests on: **audits stay free, the appeal letter is paid.**

## What is live right now

| Piece | State |
|---|---|
| `functions/letter.js` + `generateLetter` | live, **free**, verified on production |
| entitlement logic (`functions/payments.js`) | live, 11 unit tests |
| `createCheckoutSession` | deployed, refuses with `failed-precondition` while off |
| `stripeWebhook` | deployed at `https://us-central1-useclaimright.cloudfunctions.net/stripeWebhook`, returns **503** while off |
| the gate in `generateLetter` | live but a no-op while off |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **placeholders**, so the code deploys — not real keys |

Verified after deploying: an unsigned POST to the webhook returns 503, `PAYMENTS=off` on all
three functions, and the letter comes back free on the live site.

## The full cycle, run in the Stripe sandbox 2026-08-26

Switched `PAYMENTS=on`, ran it end to end against sandbox keys, then switched back off.

| Step | Result |
|---|---|
| letter before payment | refused, `permission-denied` |
| `createCheckoutSession` | real `checkout.stripe.com` URL |
| **forged webhook signature** | **400, rejected** |
| valid delivery | granted exactly **1** credit |
| **same event id replayed** | granted **nothing** — still 1 |
| first letter | 1,552 chars; credit spent 1 → 0 |
| **same letter again** | returned free, **no second charge** |
| a different audit | refused — the unlock is per-audit, not a pass |

The card-entry leg on Stripe's hosted page was NOT driven from here; the webhook was exercised
with a payload signed using the endpoint's own secret, which is the identical code path through
`constructEvent`. What that does not cover is Stripe's own checkout UI, which is Stripe's to
get right.

### Two things this run turned up

**Managed Payments is on by default and refuses a line item with no tax code.** The first
`createCheckoutSession` call failed with `StripeInvalidRequestError: the product tax code is
missing`. Keeping Managed Payments and adding `tax_code: txcd_10000000` was the deliberate
choice — under it Stripe is merchant of record and handles sales-tax registration and
remittance, which for one person selling a digital product into fifty states is worth more than
the fee. The alternative, `managed_payments: { enabled: false }`, hands that problem back.
**Tax classification is a business decision**; `LETTER_TAX_CODE` is the one line to change.

**⚠️ Deleting `functions/.env` does NOT turn payments off.** A deployed function keeps env vars
from previous deploys. After deleting the file and redeploying, all three functions still had
`PAYMENTS=on` live, and the webhook proved it by returning 400 (signature failure) instead of
503 (payments off). Disable by setting `PAYMENTS=off` **explicitly** and redeploying. This is
the payments equivalent of the App Check ordering trap: the safe-looking action is not the safe
one.

---

## 0. The thing to settle before writing any code

**You cannot paywall code that runs in the browser.**

`buildDisputeEmail({ findings, totals })` runs client-side from `lastReport`, which the
client already holds. Hiding the button behind an entitlement check is theatre: anyone
who opens devtools calls the function directly. Worse, the findings are already rendered
on the page, so even a naive user can copy them.

So the first real decision is:

- **(A) Move letter generation server-side.** A callable that reads
  `users/{uid}/audits/{auditId}`, checks the entitlement, and returns the letter text.
  The findings are *already* in Firestore, so this is a move of roughly 50 lines, not a
  rewrite — and it needs **no model call**, because the letter is assembled from findings
  that were computed when the audit ran.
- **(B) Keep it client-side and accept the paywall is honour-system.**

**Recommend (A). DONE 2026-08-26**, shipped free so the move could be verified with nothing
about payments in the diff. `functions/letter.js` holds the builder, `generateLetter` is a
callable that reads `users/{uid}/audits/{auditId}` — scoped to the caller, so one member cannot
read another's findings by guessing an id — and the client calls it. Verified on production:
the shipped `app.js` contains no letter text and no builder (`buildDisputeEmail`,
`INSURER_ONLY_TYPES` and the letter's own phrases are all absent), and the server returned a
1,632-character letter with evidence quotes and placeholders intact. Seven unit tests cover the
builder, including that an insurer-only finding addresses the letter to the plan rather than
the provider.

The entitlement check goes in that callable when there is a price. Nothing else has to move.

*(Caught while verifying: `openAudit()` never set `lastAuditId`, so the button silently did
nothing on any report opened from history. The old code keyed off `lastReport`, which was set
in both paths. Fixed.)*

Note what (A) implies about the business: the letter costs **nothing** to produce (no
tokens), while the free audits are the entire cost centre. That is a sound shape — the
expensive thing is the wedge, the free-to-produce thing is the product — but it means
everything depends on the audit → letter conversion rate. `dispute_email_generated` over
`audit_completed { found: true }` is now instrumented (see `docs/ANALYTICS.md`), so
**let that number arrive before building any of this.** If people who find money do not
generate the letter, no amount of Stripe plumbing fixes it.

---

## 1. What to sell, and the arithmetic that constrains the price

**One-off purchase per letter.** Not a subscription: a person with a disputed hospital
bill has an acute problem, not an ongoing one, and a subscription for a once-a-year event
churns immediately and generates refund requests.

Stripe takes **2.9% + $0.30** on domestic cards. On a small one-off that fixed 30¢ dominates:

| Price | Stripe fee | You keep | Fee as % |
|---|---|---|---|
| $1.99 | $0.36 | $1.63 | **18.0%** |
| $2.99 | $0.39 | $2.60 | 13.0% |
| $4.99 | $0.44 | $4.55 | 8.9% |
| $9.99 | $0.59 | $9.40 | 5.9% |

At $1.99 nearly **a fifth** of the price is payment processing. That is the strongest
concrete argument for pricing at $4.99 rather than $1.99 — the fee stops being a tax on
the transaction. A credit pack ("3 letters for $9.99") sidesteps the fixed fee entirely
by amortising it, and is worth considering if the per-letter price feels too high.

Against that: an audit costs roughly **$0.01** in Gemini calls, and the daily guard is
sized at ~$20/day for 2000 calls. So one $4.99 letter pays for roughly 450 free audits.
The business only needs a small conversion rate to cover itself, which is the whole
"pays for itself" premise.

---

## 2. Which Stripe product

**Stripe Checkout** (hosted page). Not Payment Element, not Payment Links.

- **Checkout** — hosted by Stripe, so card data never touches your origin. Handles SCA/3DS,
  Apple Pay and Google Pay with no extra work, and supports `client_reference_id` so the
  session ties back to a Firebase uid. Minimal PCI scope (SAQ A).
- **Payment Element** — embedded, better-looking, but you own more of the flow and the PCI
  surface for no benefit at this scale.
- **Payment Links** — simplest, but cannot reliably attach the uid, so you cannot grant an
  entitlement to the right account.

For a product that already sends health information to a third party, "card data never
touches our origin" is worth more than a slightly nicer checkout.

---

## 3. Architecture

The existing rules already have exactly the right shape for entitlements:

```
match /users/{uid}/meta/{docId} {
  allow read:  if request.auth != null && request.auth.uid == uid;
  allow write: if false;   // Function-managed only
}
```

So the entitlement lives at `users/{uid}/meta/entitlements`, Admin-SDK-written,
client-readable. The client reads it to decide what the UI offers; the **callable**
re-checks it before returning a letter. The client-side check is UX, never enforcement.

```
  Browser                    Functions                     Stripe
     │                           │                            │
     │ createCheckoutSession() ─▶│                            │
     │                           │ sessions.create ──────────▶│
     │                           │   client_reference_id=uid  │
     │◀── { url } ───────────────│◀── session ────────────────│
     │                           │                            │
     │ redirect ─────────────────┼───────────────────────────▶│  (hosted page)
     │                           │                            │
     │                           │◀── POST /stripeWebhook ────│  checkout.session.completed
     │                           │   verify signature         │
     │                           │   grant entitlement        │
     │                           │   (idempotent on event.id) │
     │◀── redirect back ─────────┼                            │
     │                           │                            │
     │ generateLetter(auditId) ─▶│ check entitlement, decrement,
     │◀── { letter } ────────────│ return text (no model call)
```

Three new pieces:

| Piece | Type | Notes |
|---|---|---|
| `createCheckoutSession` | `onCall` | auth required; sets `client_reference_id` to `uid`; returns the hosted URL |
| `stripeWebhook` | `onRequest` | **must** verify the signature; grants the entitlement |
| `generateLetter` | `onCall` | the real gate; reads the audit, checks + decrements entitlement |

Secrets via the same mechanism as `GEMINI_API_KEY`:
`firebase functions:secrets:set STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

---

## 4. The two things that will actually break

**The raw body.** `stripe.webhooks.constructEvent()` needs the *unparsed* request body.
Firebase Functions parses JSON for you, and if you hand the parsed object to Stripe the
signature check fails 100% of the time with a misleading error. Use `req.rawBody`, which
Firebase provides on `onRequest`. This is the single most common Stripe-on-Firebase bug
and it costs people an afternoon.

**Idempotency.** Stripe retries webhooks on any non-2xx, and will happily deliver the same
event twice on a timeout even after you succeeded. Grant inside a transaction keyed on
`event.id` (e.g. a `stripeEvents/{eventId}` marker document) and no-op if it already
exists. Without this, a slow response grants two letters for one payment.

Also: return 2xx **fast**. Do the grant, return, do nothing else — Stripe times out at 20s
and starts retrying, which is how the duplicate above happens in the first place.

---

## 5. Order of work

1. **Wait for the conversion number.** `dispute_email_generated` / `audit_completed{found}`.
   This is genuinely step one; everything below is wasted if that ratio is near zero.
2. ~~**Move letter generation server-side**~~ — **DONE 2026-08-26**, free, verified.
3. Stripe account, test mode, product + price.
4. `createCheckoutSession` + `stripeWebhook` + entitlement doc, all in test mode with
   `stripe listen --forward-to` and card `4242 4242 4242 4242`.
5. Gate `generateLetter` on the entitlement. Client-side UI reflects it.
6. **Terms of Service and a refund policy** — needed before taking real money, and the
   privacy policy already needs attorney review (see TODOS). Bundle the reviews.
7. Live keys, one real purchase, refund it, verify both directions.

## 6. Deliberately out of scope

- **Subscriptions / the customer portal.** Wrong shape for an acute one-off need.
- **Stripe Tax.** US sales tax on digital goods varies by state and is a real question at
  volume; at launch volume it is not the thing that decides whether this works.
- **Automated refunds.** Do them by hand in the dashboard until the volume hurts.
- **Saved cards.** Checkout handles the one-off; storing cards adds PCI surface for a
  product people use once or twice a year.
