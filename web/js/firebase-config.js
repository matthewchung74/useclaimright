// Public identifiers (not secrets) — security comes from Auth + Firestore rules + App Check.
export const firebaseConfig = {
  apiKey: "AIzaSyD_jXQRnv5MnTrrvoA08DcJW0S1VwcIBUQ",
  authDomain: "useclaimright.firebaseapp.com",
  projectId: "useclaimright",
  storageBucket: "useclaimright.firebasestorage.app",
  messagingSenderId: "223366324716",
  appId: "1:223366324716:web:c000d277d80af403ae60c9",
  measurementId: "G-WYHQ778H14",
};

// App Check: a reCAPTCHA ENTERPRISE site key, registered against this web app
// at projects/useclaimright/apps/<appId>/recaptchaEnterpriseConfig.
//
// Enterprise rather than classic v3 because Enterprise keys can be created and
// registered entirely through the API, where a v3 key requires clicking through
// the reCAPTCHA admin console. It is a billable API with a 10,000
// assessments/month free tier; App Check mints one assessment per client per
// tokenTtl (currently 3600s), so pre-launch traffic is far inside the free tier.
//
// A site key is PUBLIC — it ships in this file and is readable by anyone. It is
// not a secret and does not need protecting. Enterprise has no separate secret
// key; the pairing lives server-side in the App Check config.
//
// Empty means App Check is not configured and the client skips it — which is
// only safe while the Functions still have enforceAppCheck off. Turning it on
// is two steps in this order, or the app goes dark:
//   1. set this key, deploy hosting, confirm requests still work   <-- DONE
//   2. set APP_CHECK=on for the Functions, redeploy                <-- deliberately NOT done
export const APP_CHECK_SITE_KEY = "6LeWbJktAAAAAOqhrLJ8gEFi1bci2Kn416Km8Kub";
