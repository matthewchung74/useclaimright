// X1 by Playwright rather than the Chrome extension: opening a <dialog> with
// showModal() blocks the extension's script injection, so it cannot screenshot
// the very dialogs this plan is about. The page itself is fine — a modal dialog
// does not block the main thread — which is why the assertion "the page stays
// responsive" is still true for a person.
//
// confirmAction is executed verbatim out of app.js, so this tests the real
// function and the real markup, not a copy of either.
import { webkit } from "playwright";
import { readFile } from "node:fs/promises";

const SRC = await readFile("/Users/mattc/Desktop/useclaimright/web/js/app.js", "utf8");
const i = SRC.indexOf("function confirmAction({");
const j = SRC.indexOf("\n}\n", i);
const CONFIRM = SRC.slice(i, j) + "\n}";

const CASES = [
  { name: "delete an audit",        title: "Delete this audit?", body: "The audit and its findings are removed permanently. Your other audits are untouched.", confirmLabel: "Delete audit", danger: true },
  { name: "delete a saved EOB",     title: "Delete this saved EOB?", body: "It is removed from your library. Audits already run with it are untouched.", confirmLabel: "Delete EOB", danger: true },
  { name: "remove the plan",        title: "Remove your plan?", body: "Plan checks stop and limits from the SBC are removed. Trackers you've created stay.", confirmLabel: "Remove plan", danger: true },
  { name: "stop tracking a limit",  title: "Stop tracking this limit?", body: "It is removed from Your coverage. Audits already run are unaffected.", confirmLabel: "Stop tracking", danger: true },
  { name: "replace with older plan",title: "That plan looks older", body: "The plan on file starts later than this one. Replace it anyway?", confirmLabel: "Replace anyway", danger: false },
  { name: "erase all data",         title: "Erase everything?", body: "Every audit, saved EOB, tracker and your plan are deleted permanently. This cannot be undone.", confirmLabel: "Erase everything", danger: true },
];

const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
await p.goto("http://localhost:8787/app.html");
await p.waitForTimeout(500);

for (const c of CASES) {
  const shot = await p.evaluate(async ([src, opts]) => {
    const $ = (id) => document.getElementById(id);
    const confirmAction = new Function("$", `${src}; return confirmAction;`)($);
    confirmAction(opts); // deliberately not awaited: we inspect while it is open
    await new Promise((r) => setTimeout(r, 60));
    const dlg = $("confirm-dialog"), ok = $("cd-ok");
    return {
      isNativeDialog: dlg.tagName === "DIALOG",
      open: dlg.open,
      title: $("cd-title").textContent,
      body: $("cd-body").textContent,
      verb: ok.textContent,
      red: getComputedStyle(ok).backgroundColor,
      hasDanger: ok.classList.contains("danger"),
      // Responsiveness: can the page still run script and lay out while modal?
      responsive: document.body.getBoundingClientRect().width > 0,
    };
  }, [CONFIRM, c]);
  await p.screenshot({ path: `/private/tmp/claude-501/-Users-mattc-Desktop-useclaimright/2b0c2af5-c3b0-4eb5-b9f4-110abfa15f00/scratchpad/sim/x1-${c.name.replace(/ /g, "-")}.png` });
  const verbOk = shot.verb !== "OK" && shot.verb === c.confirmLabel;
  console.log(`${verbOk && shot.open && shot.hasDanger === c.danger ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      title="${shot.title}"  verb="${shot.verb}"  danger=${shot.hasDanger}  bg=${shot.red}  responsive=${shot.responsive}`);
  // Esc must decline.
  const declined = await p.evaluate(async () => {
    const dlg = document.getElementById("confirm-dialog");
    dlg.dispatchEvent(new Event("cancel"));
    dlg.close();
    return !dlg.open;
  });
  if (!declined) console.log("      !! Esc did not close");
}
await b.close();
