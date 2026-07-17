"""Acceptance gates (machine-readable) + secrets scan + fixture firewall +
publication-safety wording scan + lightweight schema validation.

Writes data/validation/acceptance_gates.json
(schema: schemas/acceptance_gate.schema.json).
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

PROHIBITED_WORDS = [
    "corrupt", "captured", "unsafe", "compromised", "fragile", "suspicious",
    "exploitative", "failure risk", "monopoly abuse", "scandal", "misconduct",
    "cronyism", "profiteering", "dangerous", "rigged", "shady", "cartel",
    "captured state", "profiteer",
]

SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "aws-access-key"),
    (r"ghp_[A-Za-z0-9]{36}", "github-pat"),
    (r"sk-[A-Za-z0-9]{24,}", "generic-sk-token"),
    (r"(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9+/_\-]{16,}['\"]", "assignment"),
]

SCAN_DIRS = ["src", "scripts", "schemas", "docs", "data", "outputs", "tests"]
SCAN_EXCLUDE = {".git", "__pycache__"}

# Only user-facing output trees are subject to the wording scan; docs that
# define the prohibited list and this module are exempt by design.
WORDING_SCAN_DIRS = ["outputs", os.path.join("data", "exports"),
                     os.path.join("data", "processed")]


def _iter_files(dirs):
    for d in dirs:
        base = os.path.join(util.ROOT, d)
        if not os.path.isdir(base):
            continue
        for root, subdirs, files in os.walk(base):
            subdirs[:] = [s for s in subdirs if s not in SCAN_EXCLUDE]
            for f in files:
                yield os.path.join(root, f)


def gate(gate_id, phase, requirement, test_method, status, blocking,
         evidence_file=None, failure_reason=None, next_action=None):
    return {
        "gate_id": gate_id, "phase": phase, "requirement": requirement,
        "test_method": test_method, "status": status, "blocking": blocking,
        "evidence_file": evidence_file, "failure_reason": failure_reason,
        "next_action": next_action, "ran_at": util.utcnow(),
    }


def check_secrets() -> list[str]:
    findings = []
    env_values = [v for k, v in os.environ.items()
                  if k in ("COMPANIES_HOUSE_API_KEY",) and v and v != "proxy-injected"]
    for path in _iter_files(SCAN_DIRS):
        if path.endswith((".png", ".zip", ".ods", ".gz")):
            continue
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        rel = os.path.relpath(path, util.ROOT)
        for pattern, label in SECRET_PATTERNS:
            for m in re.finditer(pattern, text):
                frag = m.group(0)
                if "example" in rel or frag.endswith('=""') or "PATTERN" in path:
                    continue
                if rel == os.path.join("src", "validation", "gates.py"):
                    continue  # the pattern definitions themselves
                findings.append(f"{rel}: {label}: {frag[:24]}…")
        for v in env_values:
            if v in text:
                findings.append(f"{rel}: literal credential value present")
    return findings


def check_fixture_firewall() -> list[str]:
    findings = []
    for d in ["outputs", os.path.join("data", "processed"),
              os.path.join("data", "exports")]:
        for path in _iter_files([d]):
            try:
                text = open(path, "r", encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            if "FIXTURE-" in text or "SYNTHETIC_TEST_FIXTURE" in text:
                findings.append(os.path.relpath(path, util.ROOT))
    return findings


def check_prohibited_wording() -> list[str]:
    findings = []
    for path in _iter_files(WORDING_SCAN_DIRS):
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read().lower()
        except Exception:
            continue
        for w in PROHIBITED_WORDS:
            if re.search(r"\b" + re.escape(w) + r"\b", text):
                findings.append(f"{os.path.relpath(path, util.ROOT)}: '{w}'")
    return findings


def check_raw_meta_sidecars() -> list[str]:
    missing = []
    base = util.RAW_DIR
    for root, _, files in os.walk(base):
        for f in files:
            if f.endswith(".meta.json") or f == "probe_report.json":
                continue
            p = os.path.join(root, f)
            if not os.path.exists(p + ".meta.json"):
                missing.append(os.path.relpath(p, util.ROOT))
    return missing


def validate_against_schema(record: dict, schema_name: str) -> list[str]:
    """Lightweight validation: required keys + top-level enums/types."""
    schema = util.read_json(os.path.join(util.ROOT, "schemas", schema_name), default={})
    errors = []
    for req in schema.get("required", []):
        if req not in record:
            errors.append(f"missing required '{req}'")
    for key, spec in (schema.get("properties") or {}).items():
        if key not in record or not isinstance(spec, dict):
            continue
        val = record[key]
        if "enum" in spec and val is not None and val not in spec["enum"]:
            errors.append(f"'{key}'={val!r} not in enum")
        t = spec.get("type")
        if t == "string" and val is not None and not isinstance(val, str):
            errors.append(f"'{key}' not a string")
        if t == "array" and val is not None and not isinstance(val, list):
            errors.append(f"'{key}' not an array")
        if t == "boolean" and val is not None and not isinstance(val, bool):
            errors.append(f"'{key}' not a boolean")
    return errors


def validate_truth_slice(slice_doc: dict) -> tuple[list[str], list[str]]:
    """Return (schema_errors, provenance_errors) for a truth-slice doc."""
    schema_errors, prov_errors = [], []
    ledger_ids = {e["evidence_id"] for e in slice_doc.get("evidence_ledger", [])}
    pairs = [
        ("supplier", [slice_doc.get("supplier") or {}], "strategic_supplier.schema.json"),
        ("legal_entities", slice_doc.get("legal_entities", []), "legal_entity.schema.json"),
        ("contracts", slice_doc.get("contracts", []), "contract.schema.json"),
        ("public_bodies", slice_doc.get("public_bodies", []), "public_body.schema.json"),
        ("ownership_edges", slice_doc.get("ownership_edges", []), "ownership_edge.schema.json"),
        ("indicators", slice_doc.get("indicators", []), "indicator.schema.json"),
        ("manual_review_items", slice_doc.get("manual_review_items", []), "manual_review.schema.json"),
        ("evidence_ledger", slice_doc.get("evidence_ledger", []), "evidence.schema.json"),
    ]
    for label, records, schema_name in pairs:
        for i, rec in enumerate(records):
            for err in validate_against_schema(rec, schema_name):
                schema_errors.append(f"{label}[{i}]: {err}")
    # provenance: every referenced evidence id must resolve; every raw path must exist
    def resolve(ids, where):
        for eid in ids or []:
            if eid not in ledger_ids:
                prov_errors.append(f"{where}: evidence id '{eid}' not in ledger")
    resolve((slice_doc.get("supplier") or {}).get("evidence"), "supplier")
    for i, ent in enumerate(slice_doc.get("legal_entities", [])):
        resolve(ent.get("evidence"), f"legal_entities[{i}]")
        resolve((ent.get("match") or {}).get("evidence_for"), f"legal_entities[{i}].match")
    for i, c in enumerate(slice_doc.get("contracts", [])):
        resolve(c.get("evidence"), f"contracts[{i}]")
        resolve((c.get("supplier_link") or {}).get("evidence_ids"), f"contracts[{i}].link")
    for i, ind in enumerate(slice_doc.get("indicators", [])):
        resolve(ind.get("evidence_ids"), f"indicators[{i}]")
    raw_base = util.ROOT
    for e in slice_doc.get("evidence_ledger", []):
        p = os.path.join(raw_base, e.get("raw_path", ""))
        if not os.path.exists(p):
            prov_errors.append(f"ledger {e['evidence_id']}: raw file missing: {e.get('raw_path')}")
    return schema_errors, prov_errors


def run_all(slice_path: str | None = None) -> dict:
    """Run repository-level gates (+ slice gates if a slice exists)."""
    status = util.read_json(util.STATUS_PATH, default={}) or {}
    gates = []
    verdict = status.get("source_probe_verdict", "NOT_RUN")
    gates.append(gate(
        "GATE-SRC-01", "source_access",
        "Official sources retrievable (verdict PASS or PARTIAL)",
        "probe_sources verdict in status.json",
        "pass" if verdict in ("PASS", "PARTIAL") else
        ("blocked" if verdict == "BLOCKED" else "not_run"),
        True, evidence_file="data/raw/source_probe/probe_report.json",
        failure_reason=None if verdict in ("PASS", "PARTIAL") else
        "All official hosts denied by session egress policy (CONNECT 403)",
        next_action=None if verdict in ("PASS", "PARTIAL") else
        "Allowlist hosts in environment network policy or run locally; see docs/SOURCE_ACCESS_LOG.md"))

    missing_meta = check_raw_meta_sidecars()
    gates.append(gate(
        "GATE-LOCK-01", "source_lock",
        "Every raw file has a .meta.json sidecar (method, timestamp, sha256)",
        "filesystem sweep of data/raw/",
        "pass" if not missing_meta else "fail", True,
        failure_reason="; ".join(missing_meta[:5]) or None))

    lock_entries = util.read_jsonl(os.path.join(util.PROCESSED_DIR, "source_lock.jsonl"))
    locked_paths = {e.get("local_raw_path") for e in lock_entries}
    unlocked = []
    for root, _, files in os.walk(util.RAW_DIR):
        for f in files:
            if f.endswith(".meta.json") or f == "probe_report.json":
                continue
            rel = os.path.relpath(os.path.join(root, f), util.ROOT)
            if rel not in locked_paths:
                unlocked.append(rel)
    gates.append(gate(
        "GATE-LOCK-02", "source_lock",
        "Every raw file is registered in source_lock.jsonl",
        "compare data/raw sweep to data/processed/source_lock.jsonl",
        "pass" if not unlocked else "fail", True,
        failure_reason=("unregistered: " + "; ".join(unlocked[:5])) if unlocked else None,
        next_action="run: python3 scripts/atlas.py lock_sources" if unlocked else None))

    secrets = check_secrets()
    gates.append(gate(
        "GATE-SECRET-01", "secrets",
        "No credentials in code, docs, data, outputs or logs",
        "regex scan + literal env-value scan",
        "pass" if not secrets else "fail", True,
        failure_reason="; ".join(secrets[:5]) or None))

    fixture_leaks = check_fixture_firewall()
    gates.append(gate(
        "GATE-FIX-01", "fixture_firewall",
        "No fixture IDs/markers in outputs/ or data/processed|exports",
        "marker scan (FIXTURE-, SYNTHETIC_TEST_FIXTURE)",
        "pass" if not fixture_leaks else "fail", True,
        failure_reason="; ".join(fixture_leaks[:5]) or None))

    wording = check_prohibited_wording()
    gates.append(gate(
        "GATE-SAFE-01", "publication_safety",
        "No prohibited accusation wording in any output tree",
        "word list scan over outputs/, data/exports/, data/processed/",
        "pass" if not wording else "fail", True,
        failure_reason="; ".join(wording[:5]) or None))

    lic_doc = os.path.join(util.DOCS_DIR, "LICENCE_AND_TERMS_REVIEW.md")
    lic_ok = os.path.exists(lic_doc)
    lic_verified = lic_ok and "PROVISIONAL" not in open(lic_doc, encoding="utf-8").read()
    gates.append(gate(
        "GATE-LIC-01", "licence_terms",
        "Every source classified; classifications verified from live terms",
        "docs/LICENCE_AND_TERMS_REVIEW.md status marker",
        "pass" if lic_verified else ("blocked" if lic_ok else "fail"), True,
        failure_reason=None if lic_verified else
        "Classifications are PROVISIONAL (terms pages unreachable this session)",
        next_action=None if lic_verified else
        "Re-verify terms from live pages once access restored"))

    # Truth-slice gates (only when a real slice exists under data/processed)
    slice_files = []
    if os.path.isdir(util.PROCESSED_DIR):
        slice_files = [f for f in os.listdir(util.PROCESSED_DIR)
                       if f.startswith("truth_slice_") and f.endswith(".json")]
    if slice_path or slice_files:
        p = slice_path or os.path.join(util.PROCESSED_DIR, slice_files[0])
        doc = util.read_json(p, default={}) or {}
        schema_errors, prov_errors = validate_truth_slice(doc)
        gates.append(gate(
            "GATE-SCHEMA-01", "schema_validation",
            "Truth-slice records validate against JSON schemas",
            f"lightweight validator over {os.path.relpath(p, util.ROOT)}",
            "pass" if not schema_errors else "fail", True,
            failure_reason="; ".join(schema_errors[:5]) or None))
        gates.append(gate(
            "GATE-PROV-01", "provenance",
            "Every displayed claim resolves to a ledger evidence record and an existing raw file",
            "evidence-id resolution + raw-path existence",
            "pass" if not prov_errors else "fail", True,
            failure_reason="; ".join(prov_errors[:5]) or None))
        linked = doc.get("contracts", [])
        gates.append(gate(
            "GATE-SLICE-01", "truth_slice",
            ">=3 linked procurement records or documented reason",
            "count contracts in slice",
            "pass" if len(linked) >= 3 else "fail", False,
            failure_reason=None if len(linked) >= 3 else
            f"only {len(linked)} linked records"))
    else:
        for gid, phase, req in [
            ("GATE-SCHEMA-01", "schema_validation", "Truth-slice records validate against JSON schemas"),
            ("GATE-PROV-01", "provenance", "Every displayed claim resolves to evidence"),
            ("GATE-SLICE-01", "truth_slice", ">=3 linked procurement records")]:
            gates.append(gate(gid, phase, req, "requires a built truth slice",
                              "blocked", True,
                              failure_reason="No truth slice exists (source access BLOCKED)",
                              next_action="Restore source access, then: fetch_suppliers, fetch procurement, build_truth_slice"))

    report = {
        "ran_at": util.utcnow(),
        "gates": gates,
        "summary": {
            "pass": sum(1 for g in gates if g["status"] == "pass"),
            "fail": sum(1 for g in gates if g["status"] == "fail"),
            "blocked": sum(1 for g in gates if g["status"] == "blocked"),
            "not_run": sum(1 for g in gates if g["status"] == "not_run"),
        },
    }
    util.write_json(os.path.join(util.VALIDATION_DIR, "acceptance_gates.json"), report)
    util.ledger("run_acceptance_gates",
                f"pass={report['summary']['pass']} fail={report['summary']['fail']} "
                f"blocked={report['summary']['blocked']}")
    return report


if __name__ == "__main__":
    print(json.dumps(run_all().get("summary"), indent=2))
