# UseClaimRight — setup & verification checklist

> **Status 2026-08-03:** Steps 1, 2, 4, 6 DONE. New project `useclaimright` under
> matthewchung74@gmail.com; billing linked to the existing "Firebase Payment" account;
> $25/mo budget with 50/90/100% alerts; GEMINI_API_KEY secret set (validated,
> `gemini-3.6-flash` confirmed live); hosting + rules + analyze Function deployed to
> https://useclaimright.web.app with public invoker + in-function auth verified.
> REMAINING: step 3 (Auth providers — Console), step 7 (App Check),
> custom-domain reconnect (Namecheap), and the verification runs below.
>
> **Status 2026-08-24:** budget verified ($25/mo, 50/90/100%). Auth confirmed working
> against the emulator end to end. Redaction removed; tesseract removed; global spend
> guard live. App Check wired on both sides but OFF until step 7 is done in order.

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
- **AC1 disclosure honesty:** on-device redaction was removed 2026-08-23, so this used to be
  a leak test and is now the opposite. Run a full audit with DevTools → Network open and
  confirm the payload contains exactly what the disclosure says it does: the document text,
  personal details included. What must be true is that the app SAID so first — the "Where
  your documents go" banner is on the audit form, above the dropzones.
- **AC2 ground truth:** BEFORE running your own bill, write down the discrepancies you know are
  in it. Then run it. The report must find them with correct amounts.
- **AC3 bake-off:** run the same redacted pair against `gemini-3.6-flash` (default) and one
  stronger model (set `MODEL_ID=gemini-3.1-pro` env on the function, redeploy or use emulator).
  Missed findings or fabrications ⇒ upgrade the default. Tie ⇒ keep Flash.
- **AC5 rules tests:** `brew install openjdk` (emulator needs Java), then
  `firebase emulators:exec --only firestore --project demo-useclaimright "npm --prefix functions test"`
- **AC6/7 scan path:** photograph a bill, upload the photo. There is no text layer, so the
  pages go to the model as images (tesseract was removed 2026-08-23). The 📷 banner must
  appear on review, the right-hand pane explains the pages are read directly rather than
  showing text, and the stored audit's `bill`/`eob` must hold the model's transcription —
  that is what history, the bill fingerprint and saved-EOB matching run on.

## Known limitations / notes
- Documents are sent to Gemini as printed, personal details included. `web/privacy.html`
  describes this, and it has still had no attorney review.
- The concierge copy this file used to warn about is gone from the marketing page.
- Test data: `test-fixtures/real-sbc/` holds genuine CMS sample SBCs and
  `test-fixtures/real-eob/` a real CMS sample EOB layout. There is no public corpus of
  real EOB documents — they are payer-specific and full of PHI — so `test-fixtures/family/`
  synthesizes a consolidated family EOB using the CMS column vocabulary.
