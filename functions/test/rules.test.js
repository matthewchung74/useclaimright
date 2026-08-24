// Firestore security rules tests. Requires the emulator:
//   firebase emulators:exec --only firestore "npm --prefix functions test"
// Skips itself when no emulator is present so plain `npm test` stays green.
import { test } from "node:test";
import assert from "node:assert/strict";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

if (!EMULATOR) {
  test("firestore rules (SKIPPED — no emulator; run via firebase emulators:exec)", { skip: true }, () => {});
} else {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import(
    "@firebase/rules-unit-testing"
  );
  const { readFileSync } = await import("node:fs");

  const env = await initializeTestEnvironment({
    projectId: "useclaimright-test",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });

  const alice = env.authenticatedContext("alice").firestore();
  const mallory = env.authenticatedContext("mallory").firestore();
  const anon = env.unauthenticatedContext().firestore();

  // Seed an audit as the server would (rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/alice/audits/a1").set({ findings: [], createdAt: new Date() });
  });

  test("owner can read their own audit", async () => {
    await assertSucceeds(alice.doc("users/alice/audits/a1").get());
  });

  test("owner can delete their own audit", async () => {
    await assertSucceeds(alice.doc("users/alice/audits/a1").delete());
  });

  test("another user cannot read someone else's audit", async () => {
    await assertFails(mallory.doc("users/alice/audits/a1").get());
  });

  test("unauthenticated cannot read audits", async () => {
    await assertFails(anon.doc("users/alice/audits/a1").get());
  });

  test("clients cannot create audits (Function is the sole writer)", async () => {
    await assertFails(alice.doc("users/alice/audits/forged").set({ findings: [{ fake: true }] }));
  });

  test("clients cannot update audits (no findings tampering)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("users/alice/audits/a2").set({ findings: [] });
    });
    await assertFails(alice.doc("users/alice/audits/a2").update({ findings: [{ fake: true }] }));
  });

  test("owner reads their own rate-limit counter but can never write it", async () => {
    // Read is allowed so the app can show remaining audits; a client that could
    // write would simply zero the count and audit without limit.
    await assertSucceeds(alice.doc("users/alice/meta/usage").get());
    await assertFails(alice.doc("users/alice/meta/usage").set({ count: 0 }));
    await assertFails(alice.doc("users/alice/meta/usage").update({ count: 0 }));
  });

  test("another user's counter stays unreadable", async () => {
    await assertFails(mallory.doc("users/alice/meta/usage").get());
  });

  test("owner can create, read, and delete their trackers", async () => {
    await assertSucceeds(alice.doc("users/alice/trackers/th").set({ label: "Psychotherapy", codes: ["90837"], limit: 6, planYearStartMonth: 1 }));
    await assertSucceeds(alice.doc("users/alice/trackers/th").get());
    await assertSucceeds(alice.doc("users/alice/trackers/th").delete());
  });

  test("another user cannot read or write my trackers", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("users/alice/trackers/th2").set({ label: "PT", codes: ["97110"], limit: 20 });
    });
    await assertFails(mallory.doc("users/alice/trackers/th2").get());
    await assertFails(mallory.doc("users/alice/trackers/th2").set({ limit: 999 }));
  });

  test("unauthenticated cannot read trackers", async () => {
    await assertFails(anon.doc("users/alice/trackers/th2").get());
  });

  test("owner can create, read, and delete their saved EOBs", async () => {
    await assertSucceeds(alice.doc("users/alice/eobs/e1").set({ label: "Acme · 2026-01-15", text: "..." }));
    await assertSucceeds(alice.doc("users/alice/eobs/e1").get());
    await assertSucceeds(alice.doc("users/alice/eobs/e1").delete());
  });

  test("another user cannot read or write my saved EOBs", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("users/alice/eobs/e2").set({ label: "x", text: "y" });
    });
    await assertFails(mallory.doc("users/alice/eobs/e2").get());
    await assertFails(mallory.doc("users/alice/eobs/e2").set({ text: "forged" }));
    await assertFails(anon.doc("users/alice/eobs/e2").get());
  });

  // Plan doc: written exclusively by the extractPlan Function (Admin SDK).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/alice/plan/active").set({ structured: {}, digest: "" });
  });
  test("plan: owner can read and delete; nobody can write", async () => {
    await assertSucceeds(alice.doc("users/alice/plan/active").get());
    await assertFails(alice.doc("users/alice/plan/active").set({ structured: {} }));
    await assertFails(mallory.doc("users/alice/plan/active").get());
    await assertFails(anon.doc("users/alice/plan/active").get());
    await assertSucceeds(alice.doc("users/alice/plan/active").delete());
  });

  test("feedback: no client access at all (Function sole writer)", async () => {
    await assertFails(alice.doc("feedback/f1").set({ message: "hi" }));
    await assertFails(alice.doc("feedback/f1").get());
    await assertFails(anon.doc("feedback/f1").get());
  });

  test.after(async () => { await env.cleanup(); });
}
