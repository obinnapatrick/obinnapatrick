"""Tests for the local execution bridge (all offline, fixture-safe).

Covers: preflight classification logic, CF REST2 defensive parsing,
inbox importer acceptance/refusal rules (in a temp raw root - never
data/raw), orchestrator stage-state resume bookkeeping, and the Level-4
verifier's rejection of fixture data.

Run: python3 tests/test_local_bridge.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

failures: list[str] = []


def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --- 1. preflight classification logic ------------------------------------
pf = _load("scripts/preflight_local.py", "preflight_local")
BASE = dict(git_available=True, python_ok=True, repo_writable=True,
            branch="claude/uk-supplier-dependency-atlas-ukhu0y",
            tree_dirty=False, govuk_reachable=True, fts_reachable=True,
            cf_reachable=True, ch_reachable=True, ch_key_present=True,
            missing_dirs=[], fixture_leaks=[], secrets_findings=[])

cls, _ = pf.classify(dict(BASE))
check(cls == "READY", "preflight: all green -> READY")
cls, notes = pf.classify(dict(BASE, ch_key_present=False))
check(cls == "READY_WITH_LIMITATIONS" and any("KEY" in n or "key" in n for n in notes),
      "preflight: missing CH key -> READY_WITH_LIMITATIONS")
cls, _ = pf.classify(dict(BASE, fts_reachable=False))
check(cls == "READY_WITH_LIMITATIONS", "preflight: FTS down alone -> limitations")
cls, _ = pf.classify(dict(BASE, govuk_reachable=False))
check(cls == "BLOCKED", "preflight: GOV.UK unreachable -> BLOCKED")
cls, _ = pf.classify(dict(BASE, fts_reachable=False, cf_reachable=False))
check(cls == "BLOCKED", "preflight: both procurement sources down -> BLOCKED")
cls, _ = pf.classify(dict(BASE, secrets_findings=["x"]))
check(cls == "BLOCKED", "preflight: secrets finding -> BLOCKED")

# --- 2. CF REST2 defensive parser -----------------------------------------
from src.ingest import contracts_finder as cf  # noqa: E402

with tempfile.TemporaryDirectory() as td:
    d = os.path.join(td, "procurement")
    os.makedirs(d)
    good = {"SYNTHETIC_TEST_FIXTURE": True,
            "noticeList": [{"item": {
                "id": "FIXREST-001", "title": "Fixture rest2 award",
                "organisationName": "Fixture Buyer Dept",
                "awardedSupplier": "Fixturecorp Technology Services",
                "awardedValue": 50000, "publishedDate": "2026-05-01",
                "cpvCodes": "72000000,72300000"}}]}
    with open(os.path.join(d, "cf_search_fix_20260717.json"), "w") as f:
        json.dump(good, f)
    with open(os.path.join(d, "cf_search_fix_20260717.json.meta.json"), "w") as f:
        json.dump({"SYNTHETIC_TEST_FIXTURE": True, "saved_at": "2026-07-17T10:00:00Z",
                   "source_url": "https://fixture.invalid/cf"}, f)
    unknown = {"SYNTHETIC_TEST_FIXTURE": True, "surprising": {"shape": 1}}
    with open(os.path.join(d, "cf_search_odd_20260717.json"), "w") as f:
        json.dump(unknown, f)
    with open(os.path.join(d, "cf_search_odd_20260717.json.meta.json"), "w") as f:
        json.dump({"SYNTHETIC_TEST_FIXTURE": True}, f)
    contracts, evidence = cf.load_offline_rest2(td)
    check(len(contracts) == 1, "rest2: recognised shape parsed (1 record)")
    c = contracts[0]
    check(c["buyer"]["name"] == "Fixture Buyer Dept"
          and c["suppliers"][0]["name"] == "Fixturecorp Technology Services"
          and c["value"]["amount"] == 50000
          and len(c["cpv"]) == 2,
          "rest2: fields mapped with evidence ids")
    check(all(e["evidence_id"].startswith("FIXTURE-") for e in evidence),
          "rest2: fixture meta forces FIXTURE- evidence prefix")
    check(all(any(e["evidence_id"] == ev and e["json_pointer"].startswith("/noticeList/0/item")
                  for e in evidence) for ev in c["evidence"][:2]),
          "rest2: evidence pointers reference the saved search payload")

# --- 3. inbox importer ------------------------------------------------------
from src.ingest.inbox_import import import_all  # noqa: E402

with tempfile.TemporaryDirectory() as td:
    inbox = os.path.join(td, "inbox")
    rawroot = os.path.join(td, "raw")
    os.makedirs(inbox)
    ocds = {"releases": [{"ocid": "test-1", "id": "r1"}]}
    with open(os.path.join(inbox, "package.json"), "w") as f:
        json.dump(ocds, f)
    with open(os.path.join(inbox, "package.json.source.json"), "w") as f:
        json.dump({"source_url": "https://www.find-tender.service.gov.uk/api/x",
                   "retrieved_at": "2026-07-17T10:00:00Z",
                   "retrieval_method": "manual browser download"}, f)
    with open(os.path.join(inbox, "nosidecar.json"), "w") as f:
        json.dump(ocds, f)
    with open(os.path.join(inbox, "badhost.json"), "w") as f:
        json.dump(ocds, f)
    with open(os.path.join(inbox, "badhost.json.source.json"), "w") as f:
        json.dump({"source_url": "https://evil.example.com/x",
                   "retrieved_at": "2026-07-17T10:00:00Z",
                   "retrieval_method": "manual"}, f)
    with open(os.path.join(inbox, "mystery.json"), "w") as f:
        json.dump({"who": "knows"}, f)
    with open(os.path.join(inbox, "mystery.json.source.json"), "w") as f:
        json.dump({"source_url": "https://www.gov.uk/x",
                   "retrieved_at": "2026-07-17", "retrieval_method": "manual"}, f)
    chprof = {"company_number": "TEST01", "company_name": "TEST LTD",
              "registered_office_address": {"address_line_1": "1 Secret Lane",
                                              "locality": "Town", "postal_code": "T1 1TT"}}
    with open(os.path.join(inbox, "chprofile.json"), "w") as f:
        json.dump(chprof, f)
    with open(os.path.join(inbox, "chprofile.json.source.json"), "w") as f:
        json.dump({"source_url": "https://api.company-information.service.gov.uk/company/TEST01",
                   "retrieved_at": "2026-07-17T10:00:00Z",
                   "retrieval_method": "manual browser download"}, f)

    report = import_all(inbox_dir=inbox, raw_root=rawroot)
    imported = {r["file"] for r in report["imported"]}
    refused = {r["file"]: r["reason"] for r in report["refused"]}
    check(imported == {"package.json", "chprofile.json"},
          f"inbox: official files imported ({sorted(imported)})")
    check("nosidecar.json" in refused and "sidecar" in refused["nosidecar.json"],
          "inbox: missing sidecar refused")
    check("badhost.json" in refused and "official" in refused["badhost.json"],
          "inbox: non-official domain refused")
    check("mystery.json" in refused, "inbox: unrecognised structure refused")
    check(os.path.exists(os.path.join(inbox, "package.json")),
          "inbox: original file preserved (copied, not moved)")
    imported_ch = [os.path.join(dp, f) for dp, _, fs in os.walk(rawroot)
                   for f in fs if f.endswith(".json") and "chprofile" in f
                   and not f.endswith(".meta.json")]
    ch_doc = json.load(open(imported_ch[0]))
    check("address_line_1" not in json.dumps(ch_doc)
          and ch_doc["registered_office_address"].get("postal_code") == "T1 1TT",
          "inbox: CH import minimised (street removed, postcode kept)")
    meta = json.load(open(imported_ch[0] + ".meta.json"))
    check(meta.get("manual_import") is True
          and meta.get("import_verification") == "pending_manual_review",
          "inbox: manual import flagged for provenance review")
    # dry run writes nothing
    report2 = import_all(inbox_dir=inbox, raw_root=os.path.join(td, "raw2"),
                         dry_run=True)
    check(not os.path.isdir(os.path.join(td, "raw2"))
          and all(r.get("dry_run") for r in report2["imported"]),
          "inbox: --dry-run validates without writing")

# --- 4. orchestrator stage-state bookkeeping -------------------------------
r4 = _load("scripts/run_level4.py", "run_level4")
with tempfile.TemporaryDirectory() as td:
    old = r4.STATE_PATH
    r4.STATE_PATH = os.path.join(td, "level4_run.json")
    try:
        state = r4._state()
        check(state == {"stages": {}}, "orchestrator: empty state initialises")
        r4._mark(state, "fetch_suppliers", "done", "saved 2 raw files")
        state2 = r4._state()
        check(state2["stages"]["fetch_suppliers"]["status"] == "done",
              "orchestrator: stage completion persists across reload")
        check("fetch_suppliers" in r4.SKIPPABLE
              and "acceptance_gates" not in r4.SKIPPABLE
              and "verify_level4" not in r4.SKIPPABLE,
              "orchestrator: fetches skippable on resume; gates/verify always rerun")
    finally:
        r4.STATE_PATH = old

# --- 5. verifier rejects fixtures (selftest) --------------------------------
proc = subprocess.run([sys.executable,
                       os.path.join(ROOT, "scripts", "verify_level4.py"),
                       "--selftest"], capture_output=True, text=True, cwd=ROOT)
check(proc.returncode == 0 and "SELFTEST PASS" in proc.stdout,
      f"verifier selftest rejects fixture data (rc={proc.returncode})")

# --- 6. verifier fails cleanly with no real slice ---------------------------
proc = subprocess.run([sys.executable,
                       os.path.join(ROOT, "scripts", "verify_level4.py")],
                      capture_output=True, text=True, cwd=ROOT)
check(proc.returncode == 1 and "no real truth slice" in proc.stderr,
      "verifier: no real slice -> clean failure, no crash")

print(f"\n{len(failures)} failure(s)")
for f in failures:
    print(" -", f)
sys.exit(1 if failures else 0)
