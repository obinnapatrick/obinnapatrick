#!/usr/bin/env python3
"""Local execution preflight.

Produces a plain table covering tooling, repository state, official-source
reachability, credentials presence (never values), firewall integrity and
overall readiness, then classifies:

  READY                  - ready to execute the real truth slice
  READY_WITH_LIMITATIONS - can proceed; an optional source/enrichment is absent
  BLOCKED                - no lawful route to required real evidence

Writes data/validation/preflight.json and per-host access-test evidence to
data/raw/source_probe/preflight_*.json. Exit codes: 0 (READY or
READY_WITH_LIMITATIONS), 3 (BLOCKED), 2 (environment error).

ASCII-only output for Windows console safety.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src import util  # noqa: E402
from src.validation import gates as gates_mod  # noqa: E402

try:  # keep Windows cp1252 consoles safe
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

REQUIRED_DIRS = [
    "data/raw/source_probe", "data/raw/strategic_suppliers",
    "data/raw/procurement", "data/raw/companies_house",
    "data/processed", "data/validation", "data/manual_review",
    "data/inbox", "outputs/profiles", "schemas", "docs", "tests/fixtures",
]


def _probe(name: str, url: str, headers: dict | None = None) -> dict:
    r = util.http_fetch(url, headers=headers, timeout=25, retries=0)
    reachable = r.get("status") is not None
    rec = {
        "probe": name, "url": url, "http_status": r.get("status"),
        "reachable": reachable, "error": r.get("error"),
        "tested_at": util.utcnow(),
    }
    util.save_raw(
        os.path.join("source_probe", f"preflight_{name}_{util.today_compact()}.json"),
        json.dumps(rec, indent=2).encode(),
        {"source_name": f"preflight probe: {name}", "source_url": url,
         "retrieval_method": "HTTP GET (local preflight)",
         "http_status": r.get("status"), "error": r.get("error"),
         "evidence_class": "ACCESS_TEST"})
    return rec


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                             text=True, timeout=30)
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def classify(checks: dict) -> tuple[str, list[str]]:
    """Pure classification logic (unit-tested in tests/test_local_bridge.py)."""
    limits, blockers = [], []
    if not checks["govuk_reachable"]:
        blockers.append("GOV.UK unreachable - the official supplier list cannot be captured")
    if not checks["fts_reachable"] and not checks["cf_reachable"]:
        blockers.append("Neither Find a Tender nor Contracts Finder reachable - no procurement evidence path")
    if checks["secrets_findings"]:
        blockers.append("secrets scan failed - fix before any run")
    if checks["fixture_leaks"]:
        blockers.append("fixture firewall breached - quarantine before any run")
    if not checks["repo_writable"]:
        blockers.append("repository not writable")
    if blockers:
        return "BLOCKED", blockers
    if not checks["fts_reachable"]:
        limits.append("Find a Tender unreachable - above-threshold notices unavailable this run")
    if not checks["cf_reachable"]:
        limits.append("Contracts Finder unreachable - keyword discovery unavailable this run")
    if not checks["ch_reachable"]:
        limits.append("Companies House API unreachable - enrichment deferred (GB-COH identifiers still usable)")
    elif not checks["ch_key_present"]:
        limits.append("COMPANIES_HOUSE_API_KEY absent - CH enrichment skipped; free key: "
                      "https://developer.company-information.service.gov.uk/")
    if not checks["git_available"]:
        limits.append("git not found - run works, but commits/handoff refresh will be manual")
    if checks["tree_dirty"]:
        limits.append("working tree has uncommitted changes - run is allowed; commit when done")
    return ("READY_WITH_LIMITATIONS" if limits else "READY"), limits


def run() -> dict:
    rows = []

    def row(label: str, value, ok: bool | None):
        mark = "OK " if ok else ("-- " if ok is None else "!! ")
        rows.append(f"{mark}{label:<46} {value}")

    git_ver = None
    if shutil.which("git"):
        git_ver = _git("--version")
    row("Git installed", git_ver or "NOT FOUND", bool(git_ver))

    py = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    py_ok = sys.version_info >= (3, 9)
    row("Python version (need 3.9+)", py, py_ok)

    writable = os.access(ROOT, os.W_OK)
    try:
        probe_path = os.path.join(ROOT, "data", "validation", ".write_test")
        os.makedirs(os.path.dirname(probe_path), exist_ok=True)
        open(probe_path, "w").close()
        os.remove(probe_path)
        writable = True
    except Exception:
        writable = False
    row("Repository writable", str(writable), writable)

    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    row("Current branch", branch or "unknown",
        branch == "claude/uk-supplier-dependency-atlas-ukhu0y" if branch else None)
    dirty = bool(_git("status", "--porcelain"))
    row("Working tree", "dirty" if dirty else "clean", not dirty if branch else None)

    missing_dirs = [d for d in REQUIRED_DIRS
                    if not os.path.isdir(os.path.join(ROOT, d))]
    row("Required folders present",
        "all present" if not missing_dirs else f"missing: {missing_dirs}", not missing_dirs)
    for d in missing_dirs:
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)

    now = dt.datetime.now(dt.timezone.utc)
    frm = (now - dt.timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S")
    to = now.strftime("%Y-%m-%dT%H:%M:%S")
    p_govuk = _probe("govuk", "https://www.gov.uk/api/content/government/publications/"
                               "crown-representatives-and-strategic-suppliers")
    p_fts = _probe("fts", "https://www.find-tender.service.gov.uk/api/1.0/"
                           f"ocdsReleasePackages?updatedFrom={frm}&updatedTo={to}")
    p_cf = _probe("cf", "https://www.contractsfinder.service.gov.uk/api/rest/2/"
                         "search_notices/json?keyword=infrastructure&size=1")
    p_ch = _probe("ch", "https://api.company-information.service.gov.uk/company/00000006")

    def net_row(label, p, ok_note=""):
        state = (f"reachable (HTTP {p['http_status']}){ok_note}" if p["reachable"]
                 else f"UNREACHABLE ({str(p['error'])[:60]})")
        row(label, state, p["reachable"])

    net_row("GOV.UK official source", p_govuk)
    net_row("Find a Tender API", p_fts)
    net_row("Contracts Finder API", p_cf)
    ch_note = " - 401 means reachable, key needed" if p_ch.get("http_status") == 401 else ""
    net_row("Companies House API", p_ch, ch_note)

    key_present = bool(os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip())
    row("COMPANIES_HOUSE_API_KEY", "present (value not shown)" if key_present
        else "absent (optional; key-free path available)", key_present or None)

    fixture_leaks = gates_mod.check_fixture_firewall()
    row("Fixture firewall intact", "yes" if not fixture_leaks
        else f"BREACH: {fixture_leaks[:3]}", not fixture_leaks)
    secrets = gates_mod.check_secrets()
    row("Secrets scan", "clean" if not secrets else f"FINDINGS: {secrets[:3]}",
        not secrets)

    checks = {
        "git_available": bool(git_ver),
        "python_ok": py_ok,
        "repo_writable": writable,
        "branch": branch,
        "tree_dirty": dirty,
        "govuk_reachable": p_govuk["reachable"],
        "fts_reachable": p_fts["reachable"],
        "cf_reachable": p_cf["reachable"],
        "ch_reachable": p_ch["reachable"],
        "ch_key_present": key_present,
        "missing_dirs": missing_dirs,
        "fixture_leaks": fixture_leaks,
        "secrets_findings": secrets,
    }
    readiness, notes = classify(checks)
    row("Local run readiness", readiness, readiness != "BLOCKED")

    print("\n=== ATLAS LOCAL PREFLIGHT ===")
    for r in rows:
        print(" " + r)
    if notes:
        print("\n Notes:")
        for n in notes:
            print("  - " + n)
    print("\n Classification: " + readiness)
    if readiness == "BLOCKED":
        print(" Do NOT proceed to real output. Fix the blockers above.")
        print(" If official hosts are unreachable from this network, run on a")
        print(" machine with ordinary internet access, or use the file-drop")
        print(" fallback described in data/inbox/README.md.")

    report = {"ran_at": util.utcnow(), "classification": readiness,
              "notes": notes, "checks": {k: v for k, v in checks.items()},
              "probes": [p_govuk, p_fts, p_cf, p_ch]}
    util.write_json(os.path.join(util.VALIDATION_DIR, "preflight.json"), report)
    util.update_status(preflight_classification=readiness,
                       preflight_at=report["ran_at"])
    util.ledger("preflight_local", readiness)
    return report


if __name__ == "__main__":
    try:
        rep = run()
    except Exception as e:  # environment error, not a readiness verdict
        print(f"PREFLIGHT ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
    sys.exit(3 if rep["classification"] == "BLOCKED" else 0)
