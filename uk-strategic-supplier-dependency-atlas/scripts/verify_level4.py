#!/usr/bin/env python3
"""Level-4 verifier: real-data invariants for the one-supplier profile.

Checks (mission sections 7-8): the slice is real (not fixture), every
ledger record is EVIDENCE-class with an existing locked raw file, every
displayed claim resolves, entities/contracts/indicators/manual-review
minimums hold, the rendered HTML carries no fixture markers and only
evidence-backed chips. On failure, any HTML under outputs/profiles is
QUARANTINED to outputs/profiles/_quarantine/ (raw evidence is never
touched). Exit 0 pass, 1 fail, 2 environment error.

--selftest: proves the verifier REJECTS fixture data by running the same
invariants against the synthetic fixture slice and requiring fixture-
related errors. No quarantine in selftest.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src import util  # noqa: E402
from src.validation.gates import validate_truth_slice, check_prohibited_wording  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _newest(pattern: str) -> str | None:
    files = sorted(glob.glob(pattern), key=os.path.getmtime)
    return files[-1] if files else None


def run_invariants(slice_path: str, html_path: str | None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    doc = util.read_json(slice_path, default=None)
    if not doc:
        return [f"cannot read slice: {slice_path}"], warnings
    meta = doc.get("meta") or {}

    if meta.get("fixture_mode"):
        errors.append("slice is flagged fixture_mode - fixtures may never appear as real output")
    if meta.get("raw_root") not in ("data/raw", os.path.join("data", "raw")):
        errors.append(f"slice raw_root is '{meta.get('raw_root')}', expected data/raw")

    ledger = doc.get("evidence_ledger") or []
    if not ledger:
        errors.append("evidence ledger is empty")
    lock = {e.get("local_raw_path"): e for e in
            util.read_jsonl(os.path.join(util.PROCESSED_DIR, "source_lock.jsonl"))}
    for e in ledger:
        eid = e.get("evidence_id", "?")
        if eid.startswith("FIXTURE-") or e.get("evidence_class") == "SYNTHETIC_TEST_FIXTURE":
            errors.append(f"fixture evidence in real slice: {eid}")
            continue
        if e.get("evidence_class") != "EVIDENCE":
            errors.append(f"{eid}: evidence_class '{e.get('evidence_class')}' "
                          "cannot support displayed facts")
        rp = e.get("raw_path", "")
        norm = rp.replace("\\", "/")
        if not norm.startswith("data/raw/"):
            errors.append(f"{eid}: raw_path outside data/raw: {rp}")
            continue
        full = os.path.join(ROOT, rp)
        if not os.path.exists(full):
            errors.append(f"{eid}: raw file missing: {rp}")
            continue
        m = util.read_json(full + ".meta.json", default={}) or {}
        if m.get("SYNTHETIC_TEST_FIXTURE"):
            errors.append(f"{eid}: raw file is a labelled fixture: {rp}")
        entry = lock.get(rp) or lock.get(norm)
        if not entry:
            errors.append(f"{eid}: raw file not registered in source lock: {rp}")
        elif entry.get("evidence_class") != "EVIDENCE":
            errors.append(f"{eid}: source-lock class '{entry.get('evidence_class')}' "
                          "is not EVIDENCE")
        elif entry.get("sha256") != util.sha256_file(full):
            errors.append(f"{eid}: raw file hash differs from source lock: {rp}")

    sup = doc.get("supplier") or {}
    sup_raw = str((sup.get("source_list") or {}).get("raw_path", "")).replace("\\", "/")
    if not sup_raw.startswith("data/raw/strategic_suppliers/"):
        errors.append(f"supplier list capture not under data/raw/strategic_suppliers: {sup_raw}")

    schema_errors, prov_errors = validate_truth_slice(doc)
    errors += [f"schema: {e}" for e in schema_errors[:10]]
    errors += [f"provenance: {e}" for e in prov_errors[:10]]

    if not doc.get("legal_entities"):
        errors.append("no legal-entity candidate in slice")
    linked = doc.get("contracts") or []
    queue = util.read_jsonl(os.path.join(util.MANUAL_REVIEW_DIR, "queue.jsonl"))
    queue_types = {q.get("issue_type") for q in queue} | \
                  {q.get("issue_type") for q in doc.get("manual_review_items") or []}
    if len(linked) < 3 and "insufficient_linked_records" not in queue_types:
        errors.append(f"only {len(linked)} linked records and no documented "
                      "insufficient_linked_records manual-review item")
    live_indicators = [i for i in doc.get("indicators") or []
                       if i.get("value") is not None]
    if len(live_indicators) < 3:
        errors.append(f"only {len(live_indicators)} indicators carry values (need >=3)")
    if not doc.get("companies_house_records"):
        if not ({"companies_house_enrichment_unavailable", "missing_company_number"}
                & queue_types):
            errors.append("no Companies House evidence AND no documented "
                          "limitation in the manual-review queue")
        else:
            warnings.append("Companies House enrichment incomplete - documented "
                            "limitation present (acceptable for Level 4)")

    status = util.read_json(util.STATUS_PATH, default={}) or {}
    if not status.get("release_state"):
        errors.append("status.json carries no release_state - run decide_release_state")
    elif status.get("release_state") == "BLOCKED_NEEDS_HUMAN_DECISION":
        warnings.append("release_state still BLOCKED_NEEDS_HUMAN_DECISION - "
                        "rerun decide_release_state after this verification")

    if html_path is None:
        errors.append("no rendered profile HTML under outputs/profiles/")
    else:
        html = open(html_path, encoding="utf-8").read()
        if "FIXTURE-" in html or "SYNTHETIC TEST FIXTURE" in html:
            errors.append("rendered profile contains fixture markers")
        if sup.get("official_name") and sup["official_name"] not in html:
            errors.append("rendered profile does not name the slice supplier")
        chip_ids = set(re.findall(r'href="#ev-([^"]+)"', html))
        ledger_ids = {e["evidence_id"] for e in ledger}
        unresolved = sorted(chip_ids - ledger_ids)[:5]
        if not chip_ids:
            errors.append("rendered profile has no evidence chips")
        if unresolved:
            errors.append(f"evidence chips without ledger records: {unresolved}")
        wording = check_prohibited_wording()
        if wording:
            errors.append(f"prohibited wording in outputs: {wording[:3]}")
    return errors, warnings


def quarantine_profiles(reason: str) -> list[str]:
    qdir = os.path.join(util.OUTPUTS_DIR, "profiles", "_quarantine")
    moved = []
    for path in glob.glob(os.path.join(util.OUTPUTS_DIR, "profiles", "*.html")):
        os.makedirs(qdir, exist_ok=True)
        dest = os.path.join(qdir, os.path.basename(path) + ".failed")
        shutil.move(path, dest)
        with open(dest + ".reason.txt", "w", encoding="utf-8") as f:
            f.write(reason)
        moved.append(os.path.relpath(dest, ROOT))
    return moved


def selftest() -> int:
    fx_slice = _newest(os.path.join(ROOT, "tests", "fixtures", "out",
                                     "truth_slice_*.json"))
    fx_html = _newest(os.path.join(ROOT, "tests", "fixtures", "out",
                                    "rendered", "*.html"))
    if not fx_slice:
        print("SELFTEST: no fixture slice found - run "
              "tests/test_pipeline_fixture.py first", file=sys.stderr)
        return 2
    errors, _ = run_invariants(fx_slice, fx_html)
    fixture_rejections = [e for e in errors if "fixture" in e.lower()]
    if len(fixture_rejections) >= 2:
        print(f"SELFTEST PASS: verifier rejected fixture data with "
              f"{len(fixture_rejections)} fixture-specific errors "
              f"({len(errors)} total)")
        return 0
    print("SELFTEST FAIL: verifier did not reject fixture data strongly "
          f"enough (fixture errors: {fixture_rejections})", file=sys.stderr)
    return 1


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    slice_path = _newest(os.path.join(util.PROCESSED_DIR, "truth_slice_*.json"))
    if not slice_path:
        print("VERIFY FAIL: no real truth slice exists under data/processed/ "
              "(this is the correct state until the fetch stages have run)",
              file=sys.stderr)
        return 1
    html_path = _newest(os.path.join(util.OUTPUTS_DIR, "profiles", "*.html"))
    errors, warnings = run_invariants(slice_path, html_path)
    report = {
        "checked_at": util.utcnow(),
        "slice": os.path.relpath(slice_path, ROOT),
        "profile": os.path.relpath(html_path, ROOT) if html_path else None,
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
    }
    util.write_json(os.path.join(util.VALIDATION_DIR,
                                  "level4_verification.json"), report)
    for w in warnings:
        print("WARN: " + w)
    if errors:
        for e in errors:
            print("FAIL: " + e, file=sys.stderr)
        moved = quarantine_profiles("Level-4 verification failed:\n- "
                                     + "\n- ".join(errors))
        if moved:
            print(f"quarantined: {moved}", file=sys.stderr)
        util.ledger("verify_level4", f"FAILED ({len(errors)} errors)")
        return 1
    print(f"VERIFY PASS: {len(util.read_json(slice_path)['evidence_ledger'])} "
          "evidence records; all Level-4 invariants hold")
    util.ledger("verify_level4", "PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"VERIFY ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
