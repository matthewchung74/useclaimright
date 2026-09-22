# Analytics — what is measured, and the one rule

Google Analytics 4, property `G-WYHQ778H14`. The marketing pages (`index.html`,
`privacy.html`) load `gtag.js` directly; the app reports through **Firebase Analytics**
in `web/js/app.js`, which uses the same measurement ID from `firebase-config.js`.

## The rule

**No property may be derived from the contents of a document.**

No amounts, provider names, procedure codes, service dates, patient names — and no
filenames, because a filename is very often the patient's name. Every property below is
structural: a count, a boolean, or a fixed enum whose values are enumerated in
`web/js/app.js`. If you cannot predict a property's possible values by reading that
source, it does not belong in an event.

This is why `audit_completed` sends `found: true` rather than the dollar figure. Whether
the product works is answerable without ever putting a number derived from someone's
medical bill into a third-party analytics system.

## The funnel

| Event | Fires when | Properties |
|---|---|---|
| `stage_viewed` | any screen transition (`show()`) | `stage`: signin \| onboarding \| bills \| upload \| review \| processing \| report |
| `signed_in` | a sign-in succeeds | `method`: google \| password \| password_signup |
| `session_authed` | every authenticated page load, from `onAuthStateChanged` | `fresh` (bool: account made in the last 2 min), `verified` (bool) |
| `audit_requested` | "Prepare audit" clicked — **before** extraction, before any model call | `pairs`, `bill_only` (counts), `saved_eob`, `no_eob` (bool) |
| `audit_prepared` | extraction finished, review screen ready | — |
| `audit_started` | "Looks right — analyze" clicked — **the click that spends money** | `kind`: single \| batch \| plan |
| `audit_completed` | a report came back | `findings` (count), `found` (bool), `plan_applied` (bool), `mode`: single \| batch |
| `batch_started` / `batch_completed` | a multi-bill run | `audits` (count, on completion) |
| `letter_requested` | **the appeal letter is asked for** — fires on the press itself, before anything can fail, so it counts intent rather than delivery | `findings` (count) |
| `dispute_email_generated` | the appeal letter is produced | `findings` (count) |
| `limit_reached` | the daily cap dialog opens | `kind`: audits \| plans |
| `error_shown` | **any** visible error (`setError()`) | `where` (element id), `reason` (enum below) |
| `eob_saved`, `plan_added`, `tracker_warning_shown` | feature use | — |
| `tracker_created` | a plan limit starts being tracked | `source`: sbc \| remark \| manual |

**Count arrivals with `session_authed`, not `signed_in`.** `signed_in` fires from the
sign-in click, which almost nobody performs: Firebase keeps the session, so a returning
member is authenticated without touching anything. On 2026-09-22 the account that ran two
audits had last signed in on the 11th, and `signed_in` had fired 19 times in 28 days
against 141 `audit_completed`. The same day it also missed a genuine first sign-in — an
account created at 14:58 UTC has its audits in the property and no `signed_in` at all, so
the promise callback did not survive the transition. `signed_in` still answers *which
method* people choose; it does not answer *how many arrived*.

`stage_viewed` and `error_shown` are wired into `show()` and `setError()` rather than
sprinkled at call sites, so they cannot drift out of date: a new screen or a new error
message is measured the day it ships, with no extra instrumentation.

### `error_shown` reasons

`limit_reached`, `no_bill_staged`, `eob_unacknowledged`, `not_an_sbc`, `file_too_large`,
`bad_credentials`, `email_in_use`, `password_problem`, `email_missing`,
`extraction_failed`, `analysis_failed`, `other`.

Messages are classified into this fixed vocabulary, never forwarded. App copy
interpolates filenames in places, and classifying rather than forwarding keeps that from
becoming an analytics payload by accident. A rising `other` count means the vocabulary
needs a new entry.

## The three questions this is built to answer

1. **Does anyone get through?** `stage_viewed` gives the whole path. The gap between
   `audit_requested` and `audit_started` is the review screen's cost in abandonment —
   everything before `audit_started` is free, so that step is where you learn whether
   asking people to check the extraction is worth what it costs.
2. **Does the product work?** `audit_completed { found }`. An audit that completes and
   finds nothing is not the same product as one that finds something, and only one of
   them has a business behind it.
3. **Is the appeal letter the thing to charge for?** `letter_requested` over
   `audit_completed { found: true }`. If people who find money do not ask for the
   letter, the letter is not the wedge, and no amount of Stripe plumbing fixes that.

   Use `letter_requested`, not `dispute_email_generated`, for this ratio. Since
   2026-09-07 the letter is not handed out — `LETTER_ENABLED` is false in `app.js`
   and the press shows "coming soon" — so `dispute_email_generated` fires zero times
   and would read as zero demand. `letter_requested` fires on the press either way,
   which is what makes the two eras comparable when the letter comes back.

`limit_reached { kind: "audits" }` is the fourth number worth watching: it says whether
the 10/day cap is protecting the budget or capping the business.

`tracker_created { source }` answers a question that cannot be answered by argument: the SBC
path auto-creates limits, the remark path offers them in one click, and "Add a custom limit" is
the hand-entry fallback. If `manual` is a rounding error next to `sbc` and `remark`, that form
is UI weight for a path nobody takes.

## Deliberately excluded

- **Amount bands** (`worth_disputing: "100-499"`). The single most useful signal for
  pricing, and still excluded — it is derived from someone's bill. Revisit only as a
  deliberate decision, not by accident.
- **Anything per-document.** No per-finding events, no document counts beyond staging.

## Verification

Events are visible in `window.dataLayer` without waiting for GA's UI:

```js
(window.dataLayer || [])
  .map(a => { const x = [...a]; return x[0] === "event" ? { event: x[1], params: x[2] } : null; })
  .filter(Boolean)
```

Verified on production 2026-08-25: `stage_viewed {stage: "upload"}`,
`audit_requested {pairs: 0, bill_only: 1, saved_eob: false, no_eob: false}`,
`error_shown {where: "upload-error", reason: "no_bill_staged"}` and
`{reason: "eob_unacknowledged"}` all fired with the right values and nothing else.
Note that GA's `/collect` calls are batched and may not appear in a network log even
when events are firing correctly — read `dataLayer`, not the network tab.
