# UseClaimRight — setup & verification checklist

> **Status 2026-08-03:** Steps 1, 2, 4, 6 DONE. New project `useclaimright` under
> matthewchung74@gmail.com; billing linked to the existing "Firebase Payment" account;
> $25/mo budget with 50/90/100% alerts; GEMINI_API_KEY secret set (validated,
> `gemini-3.6-flash` confirmed live); hosting + rules + analyze Function deployed to
> https://useclaimright.web.app with public invoker + in-function auth verified.
> REMAINING: step 3 (Auth providers — Console), step 7 (App Check),
> custom-domain reconnect (Namecheap), and the verification runs below.

Everything in the codebase is done; these are the steps that need your accounts/consoles,
in order. Items marked ☐ are yours; ▶ are commands I (or you) can run once the step above is done.

## 1. Firebase project link (blocked on login)
- ☐ `firebase login` (must complete the browser flow — last attempt left an invalid token)
- ▶ `firebase use --add` → pick the claimright project, alias `default` (writes `.firebaserc`)
- ▶ `firebase apps:sdkconfig web` → paste values into `web/js/firebase-config.js`
  (create a web app first with `firebase apps:create web useclaimright` if none exists)

## 2. Blaze + budget
- ☐ Firebase Console → upgrade project to Blaze
- ☐ GCP Console → Billing → Budgets: $25/mo budget with email alert

## 3. Auth
- ☐ Firebase Console → Authentication → Sign-in method: enable **Google** and **Email link**
- ☐ Authentication → Settings → Authorized domains: confirm your hosting domain is listed

## 4. Gemini API key
- ☐ Get a key from Google AI Studio
- ▶ `firebase functions:secrets:set GEMINI_API_KEY`

## 5. Analytics — DONE (Google Analytics, not GoatCounter)
- ✅ Google Analytics `G-WYHQ778H14` is live. `web/index.html` and `web/privacy.html` load
  `gtag.js` directly; `web/app.html` has no tag — the app page reports through **Firebase
  Analytics** in `web/js/app.js` (`getAnalytics(app)`), which uses the same measurement ID
  from `firebase-config.js`.
- Nothing to do here. (This step originally specified GoatCounter; the project shipped GA
  instead, and no `YOURCODE` placeholder exists in any page.)

## 6. Deploy
- ▶ `firebase deploy` (hosting + functions + firestore rules)

## 7. App Check (after first successful end-to-end run)
**Order matters — reversing these two steps takes the app down for everyone.**
- ☐ Console → App Check → register the web app with reCAPTCHA v3, copy the site key
- ▶ set `APP_CHECK_SITE_KEY` in `web/js/firebase-config.js`, `firebase deploy --only hosting`
- ☐ confirm audits still run (the client now sends tokens; the Functions still ignore them)
- ▶ set `APP_CHECK=on` for the Functions, redeploy. Only now are tokens required.

## 7b. Spend guard
The global ceiling and kill switch live in Firestore at `meta/guard`, so both can
be changed from the console with no deploy:
- `auditsEnabled` / `plansEnabled` — set either to `false` to stop model calls immediately
- `dailyCalls` — the global daily ceiling across ALL users (default 2000, about $20/day)

Spend is counted in `meta/spend/{YYYY-MM-DD}/shard-{0..9}`; sum them for the day's
total. Rules deny all client access to `meta/**`.
- ☑ GCP budget alert exists: **$25/month**, scoped to `projects/223366324716`
  (useclaimright), thresholds at 50% / 90% / 100%. Verified 2026-08-24 via
  `gcloud billing budgets list --billing-account=01C2D1-861724-53BC0C`.
  `notificationsRule` is empty, so it emails billing admins and does nothing
  else. That is an ALERT, not a cap — the in-app guard at `meta/guard` is what
  actually stops spend. For a hard stop on everything else, wire
  budget → Pub/Sub → disable billing, which takes the whole project offline.
- ⚠ `gcloud config` has `core/project = paidright-app`, which is deleted. Any
  gcloud command that routes quota through it fails with USER_PROJECT_DENIED.
  Fixed for billing with `gcloud config set billing/quota_project useclaimright`;
  `gcloud config set project useclaimright` would fix the rest.

## Verification (acceptance criteria)
- **AC1 seeded-PHI leak test:** make a fake bill PDF containing `LEAKCANARY-SSN 123-45-6789`,
  `leakcanary@example.com`, and a fake name. Run a full audit with DevTools → Network open.
  Search all request payloads for `LEAKCANARY`, the SSN, and the email — zero hits allowed.
  (Model-weight downloads from jsdelivr/huggingface are GETs — confirm no request bodies.)
- **AC2 ground truth:** BEFORE running your own bill, write down the discrepancies you know are
  in it. Then run it. The report must find them with correct amounts.
- **AC3 bake-off:** run the same redacted pair against `gemini-3.6-flash` (default) and one
  stronger model (set `MODEL_ID=gemini-3.1-pro` env on the function, redeploy or use emulator).
  Missed findings or fabrications ⇒ upgrade the default. Tie ⇒ keep Flash.
- **AC5 rules tests:** `brew install openjdk` (emulator needs Java), then
  `firebase emulators:exec --only firestore --project demo-useclaimright "npm --prefix functions test"`
- **AC6/7 scan path:** photograph a bill, upload the photo — OCR banner must appear on review,
  and the report must carry the scan caveat.

## Known limitations / notes
- The marketing page still advertises the parked concierge service ("We Handle It, $39").
  Copy rework is deliberately out of this build's scope — flag for a follow-up.
- De-id model: `onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX` (~90MB one-time
  browser download, then cached). Smaller 44M alternative noted in `web/js/deid.js`.
- Regex backstop (SSN/phone/email) runs on top of NER regardless.
