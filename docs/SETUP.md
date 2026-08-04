# UseClaimRight — setup & verification checklist

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

## 5. Analytics
- ☐ Create a free GoatCounter account → note your site code
- ▶ Replace `YOURCODE` in the GoatCounter tag in `web/index.html`, `web/privacy.html`, `web/app.html`

## 6. Deploy
- ▶ `firebase deploy` (hosting + functions + firestore rules)

## 7. App Check (after first successful end-to-end run)
- ☐ Console → App Check → register web app with reCAPTCHA v3
- ▶ flip `enforceAppCheck: true` in `functions/index.js`, redeploy

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
