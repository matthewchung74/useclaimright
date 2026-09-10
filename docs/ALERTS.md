# Being told, rather than remembering to look

Feedback used to land in Firestore and stop there. The `feedback` collection is
closed to clients, so the Firebase console was the only way to know a message
existed — and the person most worth hearing from is the one who hit a broken
edge and is not coming back. Waiting for someone to remember to look is the
wrong way round.

There is **no SMTP anywhere in this project** and this needs none. Firebase's
built-in email is auth-only (verification, password reset, email change — the
`noreply@useclaimright.com` sender), and the Trigger Email extension is a
wrapper around SMTP credentials we do not have. Cloud Monitoring sends the mail
itself: no provider, no signup, no phone number.

## How it works

1. `submitFeedback` logs **one JSON object** with `marker: "FEEDBACK_RECEIVED"`,
   plus `category`, `screen`, `auditId`, `from` and `message`. One object, so
   Cloud Run parses it into `jsonPayload` fields rather than a flat string.
2. The alert policy **Member feedback received** matches
   `jsonPayload.marker="FEEDBACK_RECEIVED"` and pulls those fields out with
   `labelExtractors`, which is what puts the actual message in the email. An
   alert saying only "a log matched" leaves you clicking through to Cloud
   Logging, which is the looking-it-up this exists to end.
3. It notifies **`the owner's address`** only. Neither channel needed
   verifying; the Gmail one was removed 2026-09-10 on request.

Verified end to end 2026-09-10: feedback sent from the bubble arrived at Proton
carrying `category: bug`, `from:`, and the full message text.

## Two things that will bite

**The marker is load-bearing.** Rename `FEEDBACK_RECEIVED` in
`functions/index.js`, or change the log from one JSON object to a string, and
the emails stop with no error anywhere. The policy's own documentation says so,
so it is discoverable from the alert itself.

**It is a tripwire, not a transcript.** Google requires log-based alert policies
to have a notification rate limit and enforces a floor of **300 seconds** — 30s
and 60s are both rejected. So at most one email per five minutes. On a quiet
week that is every message; during a launch burst it is a nudge, and the
complete record is the `feedback` collection in Firestore. Do not read the
absence of a second email as the absence of a second person.

This is also why an email can appear to be broken when it is not: two test
submissions inside one five-minute window produced exactly one email, and the
missing one looked like a delivery failure for a while.

## A member's audit failed

The second policy. `analyze` and `extractPlan` log `marker: MODEL_CALL_FAILED`
with the kind, model, reason and terminal flag; the alert puts the reason in the
email. Nobody files feedback about a spinner that never ends, so this is the only
way we hear about it.

Verified in anger 2026-09-10 rather than by simulation: a real Vertex 429 fired
it, and the email carried the full error. The member was not charged —
`budget.refund()` credits both their daily allowance and the shared ceiling on
that path, confirmed by the counter not moving.

**A transient failure should not reach this alert at all now.** `retry.js`
retries once, after 1.5s, for the classes that can succeed on a second attempt —
429, 5xx, dropped sockets — and not for a 400 (the request is wrong; sending it
again is a second bill) or a truncated response (the identical oversized request
truncates identically). A second failure propagates untouched, so the refund and
this alert behave exactly as before. Retries are logged as `MODEL_RETRY`, which
is worth watching: a rising count is capacity trouble before it becomes visible
to anyone.

## Not covered

Nothing tells you a member **succeeded**. There is no signal for "the first real
person outside this project ran an audit", which on a launch day is the thing
worth knowing.

## Changing it

The policy and channels live in Google Cloud, not in this repo, so there is no
`git log` for them:

    gcloud alpha monitoring policies list --project useclaimright
    gcloud alpha monitoring policies describe <policy> --project useclaimright
    gcloud alpha monitoring channels list --project useclaimright
