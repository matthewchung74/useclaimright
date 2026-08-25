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

// App Check: a reCAPTCHA v3 site key from Firebase Console → App Check.
// Empty means App Check is not configured, and the client skips it — which is
// only safe while the Functions still have enforceAppCheck off. Turning it on
// is two steps in this order, or the app goes dark:
//   1. set this key, deploy hosting, confirm requests still work
//   2. set APP_CHECK=on for the Functions, redeploy
export const APP_CHECK_SITE_KEY = "";
