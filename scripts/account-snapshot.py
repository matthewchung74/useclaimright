#!/usr/bin/env python3
"""Snapshot and restore one user's Firestore subtree, so E7 can be run for real.

E7 ("Reset account — erase all my data") used to mean losing the test account, so
it was documented as run-last-or-never. Snapshot first and it is just another
plan.

    python3 scripts/account-snapshot.py save    <uid> [--dir DIR]
    python3 scripts/account-snapshot.py restore <uid> [--dir DIR]
    python3 scripts/account-snapshot.py verify  <uid> [--dir DIR]

Auth comes from `gcloud auth print-access-token`, so be logged in as someone with
Firestore access to the project.

Restore writes each document back with PATCH to the same document ID, which
creates-or-updates. ALWAYS prove the restore path before you erase anything:

    python3 scripts/account-snapshot.py save    <real-uid>
    python3 scripts/account-snapshot.py restore throwaway-uid
    python3 scripts/account-snapshot.py verify  throwaway-uid    # must say EXACT

A restore script you have not exercised is not a backup.

Not covered: `ucr-skip-onboarding` in localStorage. It is browser-local, and E7
clears it deliberately — re-set it by hand afterwards, or accept the onboarding
screen on the next load.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

PROJECT = "useclaimright"
ROOT = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
# The saved-EOB library is "eobs", not "savedEobs" — an easy and silent mistake
# to make, because the wrong name returns an empty list rather than an error.
COLLECTIONS = ["audits", "trackers", "eobs"]
SINGLETONS = [("plan-active.json", "plan/active"), ("meta-usage.json", "meta/usage")]


def token():
    r = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
    return r.stdout.strip()


def req(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {tok}")
    r.add_header("Content-Type", "application/json")
    r.add_header("x-goog-user-project", PROJECT)
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": {"message": e.read().decode()[:300], "code": e.code}}


def docs_of(blob):
    return {d["name"].split("/")[-1]: d.get("fields", {}) for d in blob.get("documents", [])}


def save(uid, out):
    os.makedirs(out, exist_ok=True)
    tok = token()
    total = 0
    for col in COLLECTIONS:
        blob = req("GET", f"{ROOT}/users/{uid}/{col}?pageSize=300", tok)
        if "error" in blob:
            print(f"  ERROR {col}: {blob['error']['message'][:140]}")
            return 1
        json.dump(blob, open(os.path.join(out, f"{col}.json"), "w"))
        n = len(blob.get("documents", []))
        total += n
        print(f"  {col}: {n} docs")
    for fname, path in SINGLETONS:
        blob = req("GET", f"{ROOT}/users/{uid}/{path}", tok)
        json.dump(blob, open(os.path.join(out, fname), "w"))
        print(f"  {path}: {'MISSING' if 'error' in blob else 'saved'}")
        total += 0 if "error" in blob else 1
    print(f"\nsnapshot: {total} documents -> {out}")
    return 0


def restore(uid, src):
    tok = token()
    written = errors = 0

    def put(path, fields):
        nonlocal written, errors
        if not fields:
            return
        mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
        r = req("PATCH", f"{ROOT}/users/{uid}/{path}?{mask}", tok, {"fields": fields})
        if "error" in r:
            errors += 1
            print(f"  ERROR {path}: {r['error']['message'][:140]}")
        else:
            written += 1

    for col in COLLECTIONS:
        p = os.path.join(src, f"{col}.json")
        if not os.path.exists(p):
            continue
        for doc_id, fields in docs_of(json.load(open(p))).items():
            put(f"{col}/{doc_id}", fields)
    for fname, path in SINGLETONS:
        p = os.path.join(src, fname)
        if os.path.exists(p):
            put(path, json.load(open(p)).get("fields", {}))
    print(f"\nwritten: {written}   errors: {errors}")
    return 1 if errors else 0


def verify(uid, src):
    tok = token()
    ok = True
    for col in COLLECTIONS:
        p = os.path.join(src, f"{col}.json")
        if not os.path.exists(p):
            continue
        want = docs_of(json.load(open(p)))
        got = docs_of(req("GET", f"{ROOT}/users/{uid}/{col}?pageSize=300", tok))
        same = want == got
        ok &= same
        print(f"  {col}: {len(want)} -> {len(got)}   identical: {same}")
        if not same:
            for k in want:
                if want[k] != got.get(k):
                    print(f"     differs: {k}")
    for fname, path in SINGLETONS:
        p = os.path.join(src, fname)
        if not os.path.exists(p):
            continue
        want = json.load(open(p)).get("fields", {})
        got = req("GET", f"{ROOT}/users/{uid}/{path}", tok).get("fields", {})
        same = want == got
        ok &= same
        print(f"  {path}: identical: {same}")
    print("\nROUND TRIP:", "EXACT" if ok else "MISMATCH")
    return 0 if ok else 1


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("save", "restore", "verify"):
        print(__doc__)
        return 2
    cmd, uid = sys.argv[1], sys.argv[2]
    out = "account-snapshot"
    if "--dir" in sys.argv:
        out = sys.argv[sys.argv.index("--dir") + 1]
    if not token():
        print("no access token — run: gcloud auth login")
        return 1
    return {"save": save, "restore": restore, "verify": verify}[cmd](uid, out)


if __name__ == "__main__":
    sys.exit(main())
