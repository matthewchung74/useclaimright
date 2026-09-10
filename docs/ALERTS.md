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
3. It notifies two channels: `the owner's address` and
   `the owner's address`. Neither needed verifying.

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

## Not covered

**Audit failures are still silent.** A member's first real audit erroring is a
`console.error` in Cloud Logging that nobody watches. Same policy shape, and
arguably worth more than feedback on a launch day — nobody files feedback about
a spinner that never ends.

## Changing it

The policy and channels live in Google Cloud, not in this repo, so there is no
`git log` for them:

    gcloud alpha monitoring policies list --project useclaimright
    gcloud alpha monitoring policies describe <policy> --project useclaimright
    gcloud alpha monitoring channels list --project useclaimright
