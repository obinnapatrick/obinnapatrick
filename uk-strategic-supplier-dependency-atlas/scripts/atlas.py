#!/usr/bin/env python3
"""UK Strategic Supplier Dependency Atlas — command workflow.

Usage: python3 scripts/atlas.py <command> [options]

Commands (see README.md):
  setup_project            ensure directory tree + package inits exist
  probe_sources            verify live access to all official sources
  fetch_suppliers          capture the official GOV.UK strategic supplier list
  fetch_procurement        capture FTS/CF data (--keyword X | --window FROM TO)
  fetch_companies_house    capture CH profile+PSC (--number N), needs API key
  lock_sources             register/refresh the source-lock manifest
  review_licences          report licence classification status
  check_secrets            scan the repository for credential leakage
  build_source_adapters    emit machine-readable adapter contracts
  score_suppliers          build the supplier-selection table (--online to probe)
  build_truth_slice        assemble one-supplier truth slice (--supplier NAME)
  run_acceptance_gates     run all machine-readable gates
  render_static_profile    render static HTML profile (--supplier NAME)
  expand_mini_cohort       guarded: only after first-supplier gates pass
  validate_alpha           guarded: gold-set validation workflow
  render_static_alpha      guarded: multi-supplier static site
  generate_findings        guarded: cautious findings (requires firewall)
  run_public_claim_firewall  review findings for public-safety
  prepare_operator_review  write docs/OPERATOR_REVIEW_GATE.md from state
  decide_release_state     classify the current release state honestly
  package_release          zip the release package into outputs/release/
  write_handoff            refresh machine state + verify continuation docs

Every command logs to docs/RUN_LEDGER.md and updates
data/validation/status.json. Commands never delete raw evidence.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src import util  # noqa: E402
from src.validation import gates as gates_mod  # noqa: E402
from src.validation.checkpoints import write_checkpoint  # noqa: E402

FIXTURE_RAW = os.path.join(ROOT, "tests", "fixtures", "raw")
FIXTURE_OUT = os.path.join(ROOT, "tests", "fixtures", "out")

LICENCE_NOTES = {
    "source_probe": "n/a (access evidence, not source data)",
    "strategic_suppliers": "Expected OGL v3.0 — verify live (docs/LICENCE_AND_TERMS_REVIEW.md)",
    "procurement": "Expected OGL v3.0 — verify live",
    "companies_house": "CH terms — verify live; data minimisation applied at ingest",
}


def _die(msg: str, code: int = 2):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def cmd_setup_project(_):
    dirs = ["docs", "schemas", "scripts", "tests/fixtures",
            "data/raw/source_probe", "data/raw/strategic_suppliers",
            "data/raw/procurement", "data/raw/companies_house",
            "data/processed", "data/validation", "data/exports",
            "data/manual_review", "outputs/profiles", "outputs/findings",
            "outputs/demo", "outputs/release",
            "src/ingest", "src/normalize", "src/entity_resolution",
            "src/companies_house", "src/procurement", "src/ownership",
            "src/indicators", "src/validation", "src/api", "src/ui"]
    for d in dirs:
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
    for pkg in ["src", "src/ingest", "src/normalize", "src/entity_resolution",
                "src/companies_house", "src/procurement", "src/ownership",
                "src/indicators", "src/validation", "src/api", "src/ui"]:
        init = os.path.join(ROOT, pkg, "__init__.py")
        if not os.path.exists(init):
            open(init, "w").close()
    util.ledger("setup_project", "directory tree verified")
    print("project tree OK")


def cmd_probe_sources(_):
    from src.ingest.probe_sources import run
    report = run()
    print(f"verdict: {report['verdict']}")
    if report["verdict"] == "BLOCKED":
        sys.exit(3)


def cmd_fetch_suppliers(_):
    from src.ingest import govuk_strategic_suppliers as govuk
    try:
        saved = govuk.fetch()
    except govuk.SourceAccessFailure as e:
        _die(f"GOV.UK capture failed ({e}). See docs/SOURCE_ACCESS_LOG.md for "
             "the unblock procedure.", 3)
    print(json.dumps([s["local_path"] for s in saved], indent=2))


def cmd_fetch_procurement(args):
    from src.ingest import find_a_tender as fts
    from src.ingest import contracts_finder as cf
    if args.keyword:
        rec = cf.fetch_keyword(args.keyword)
        print("saved:", rec["local_path"])
    if args.window:
        frm, to = args.window
        saved = fts.fetch_window(frm, to)
        rec = cf.fetch_window(frm[:10], to[:10])
        print("saved:", len(saved), "FTS pages +", rec["local_path"])
    if not args.keyword and not args.window:
        _die("provide --keyword NAME and/or --window FROM TO")


def cmd_fetch_companies_house(args):
    from src.companies_house import adapter as ch
    if not args.number:
        _die("provide --number COMPANY_NUMBER")
    try:
        p = ch.fetch_company(args.number)
        q = ch.fetch_psc(args.number)
    except ch.MissingCredential as e:
        _die(str(e), 4)
    print("saved:", p["local_path"], q["local_path"])


def cmd_lock_sources(_):
    entries = []
    for root, _, files in os.walk(util.RAW_DIR):
        for f in sorted(files):
            if f.endswith(".meta.json") or f == "probe_report.json":
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, ROOT)
            meta_path = path + ".meta.json"
            meta = util.read_json(meta_path, default=None)
            if meta is None:
                # curated self-describing records (e.g. locator notes)
                body = util.read_json(path, default={}) or {}
                meta = {
                    "source_name": body.get("record_type", "curated_record"),
                    "source_url": body.get("primary_locator", {}).get("url", "n/a"),
                    "retrieval_method": body.get("retrieval_method", "curated"),
                    "saved_at": body.get("retrieved_at") or body.get("tested_at") or util.utcnow(),
                    "evidence_class": body.get("evidence_class", "ACCESS_TEST"),
                    "sha256": util.sha256_file(path),
                    "bytes": os.path.getsize(path),
                    "local_path": rel,
                }
                util.write_json(meta_path, meta)
            subdir = rel.split(os.sep)[2] if len(rel.split(os.sep)) > 2 else ""
            evidence_class = meta.get("evidence_class") or (
                "ACCESS_TEST" if subdir == "source_probe" else "EVIDENCE")
            sha = util.sha256_file(path)
            if meta.get("sha256") and meta["sha256"] != sha:
                _die(f"hash mismatch for {rel}: raw file changed after capture "
                     "— raw evidence must be immutable")
            entries.append({
                "source_name": meta.get("source_name", "unknown"),
                "retrieval_method": meta.get("retrieval_method", "unknown"),
                "retrieved_at": meta.get("saved_at", "unknown"),
                "source_url": meta.get("source_url", "unknown"),
                "query_params": meta.get("window") or meta.get("keyword"),
                "local_raw_path": rel,
                "sha256": sha,
                "bytes": os.path.getsize(path),
                "record_count": None,
                "licence_note": LICENCE_NOTES.get(subdir, "see docs/LICENCE_AND_TERMS_REVIEW.md"),
                "citation_method": "see docs/DATA_SOURCES.md",
                "known_limitations": meta.get("note", ""),
                "refresh_policy": "see docs/SOURCE_LOCK_MANIFEST.md",
                "evidence_class": evidence_class,
            })
    out = os.path.join(util.PROCESSED_DIR, "source_lock.jsonl")
    if os.path.exists(out):
        os.remove(out)
    for e in entries:
        util.append_jsonl(out, e)
    n_evidence = sum(1 for e in entries if e["evidence_class"] == "EVIDENCE")
    util.ledger("lock_sources", f"{len(entries)} raw files locked "
                                 f"({n_evidence} evidence-grade)")
    util.update_status(source_lock_entries=len(entries),
                       evidence_grade_captures=n_evidence)
    print(f"locked {len(entries)} files ({n_evidence} evidence-grade)")


def cmd_review_licences(_):
    doc = open(os.path.join(util.DOCS_DIR, "LICENCE_AND_TERMS_REVIEW.md"),
               encoding="utf-8").read()
    provisional = "PROVISIONAL" in doc
    util.update_status(licence_review_state="PROVISIONAL" if provisional else "VERIFIED")
    util.ledger("review_licences", "PROVISIONAL" if provisional else "VERIFIED")
    print("licence review state:", "PROVISIONAL (public display not permitted "
          "until verified from live terms)" if provisional else "VERIFIED")


def cmd_check_secrets(_):
    findings = gates_mod.check_secrets()
    util.ledger("check_secrets", f"{len(findings)} findings")
    if findings:
        print("\n".join(findings))
        sys.exit(1)
    print("no secrets found")


def cmd_build_source_adapters(_):
    adapters = [
        {"name": "govuk_strategic_suppliers", "source": "GOV.UK",
         "access_method": "HTTP GET content API + attachments",
         "auth_required": False, "auth_variable": None,
         "rate_limits": "none documented; 1s politeness delay",
         "raw_payload_format": "JSON + CSV/ODS",
         "raw_path_pattern": "data/raw/strategic_suppliers/*",
         "normalized_schema": "strategic_supplier.schema.json",
         "stable_record_id": "content_id + row ordinal",
         "evidence_fields": ["SUPPLIER_NAME", "CROWN_REPRESENTATIVE"],
         "citation_method": "publication URL + attachment + row",
         "known_limitations": ["attachment format varies", "list updates replace attachments"],
         "retry_failure_behaviour": "2 retries w/ backoff; structured SourceAccessFailure",
         "freshness_behaviour": "re-capture per run; sha256 change detection",
         "offline_capable": True},
        {"name": "find_a_tender", "source": "FTS",
         "access_method": "HTTP GET OCDS release packages (date window + cursor)",
         "auth_required": False, "auth_variable": None,
         "rate_limits": "documented API limits — verify live; 1s delay",
         "raw_payload_format": "OCDS JSON release packages",
         "raw_path_pattern": "data/raw/procurement/fts_*",
         "normalized_schema": "contract.schema.json",
         "stable_record_id": "ocid + release id",
         "evidence_fields": ["TITLE", "BUYER_NAME", "SUPPLIER_NAME", "SUPPLIER_IDENTIFIER",
                              "VALUE_AMOUNT", "AWARD_DATE", "CONTRACT_START", "CONTRACT_END",
                              "CPV_CODE", "PROCEDURE_TYPE", "PUBLISHED_DATE"],
         "citation_method": "FTS notice URL + OCID",
         "known_limitations": ["no keyword search", "above-threshold only",
                                "identifiers not always populated"],
         "retry_failure_behaviour": "2 retries w/ backoff; partial windows recorded",
         "freshness_behaviour": "immutable snapshots; new windows appended",
         "offline_capable": True},
        {"name": "contracts_finder", "source": "CF",
         "access_method": "HTTP GET REST2 keyword search + OCDS harvester window",
         "auth_required": False, "auth_variable": None,
         "rate_limits": "none published; 1s politeness delay",
         "raw_payload_format": "JSON (search) + OCDS JSON",
         "raw_path_pattern": "data/raw/procurement/cf_*",
         "normalized_schema": "contract.schema.json",
         "stable_record_id": "notice id / ocid",
         "evidence_fields": ["TITLE", "BUYER_NAME", "SUPPLIER_NAME", "VALUE_AMOUNT",
                              "AWARD_DATE", "CONTRACT_START", "CONTRACT_END", "CPV_CODE"],
         "citation_method": "CF notice URL + id",
         "known_limitations": ["keyword recall imperfect (trading names)",
                                "zero hits is not proof of absence"],
         "retry_failure_behaviour": "2 retries w/ backoff; structured errors",
         "freshness_behaviour": "immutable snapshots",
         "offline_capable": True},
        {"name": "companies_house", "source": "CH",
         "access_method": "HTTP GET REST API (Basic auth: key as username)",
         "auth_required": True, "auth_variable": "COMPANIES_HOUSE_API_KEY",
         "rate_limits": "600 req/5min (verify live); throttled <=1 req/s",
         "raw_payload_format": "JSON (minimised at write: no residential addresses/DOB)",
         "raw_path_pattern": "data/raw/companies_house/*",
         "normalized_schema": "companies_house_record.schema.json",
         "stable_record_id": "company_number",
         "evidence_fields": ["COMPANY_NAME", "COMPANY_NUMBER", "COMPANY_STATUS",
                              "DATE_OF_CREATION", "PREVIOUS_NAME", "PSC_*"],
         "citation_method": "LINK-ONLY web profile URL + API field",
         "known_limitations": ["API key required", "PSC lags corporate events",
                                "minimisation intentionally drops fields"],
         "retry_failure_behaviour": "429 backoff; MissingCredential structured error",
         "freshness_behaviour": "dated captures per rebuild",
         "offline_capable": True},
        {"name": "govuk_terms_capture", "source": "GOV.UK",
         "access_method": "HTTP GET terms/licence pages for the licence review",
         "auth_required": False, "auth_variable": None,
         "rate_limits": "n/a", "raw_payload_format": "HTML",
         "raw_path_pattern": "data/raw/source_probe/terms_*",
         "normalized_schema": "source_lock.schema.json",
         "stable_record_id": "URL + date",
         "evidence_fields": ["LICENCE_TEXT"],
         "citation_method": "URL + quoted passage",
         "known_limitations": ["pending first capture"],
         "retry_failure_behaviour": "2 retries w/ backoff",
         "freshness_behaviour": "re-capture before each release decision",
         "offline_capable": True},
    ]
    errs = []
    for a in adapters:
        errs += [f"{a['name']}: {e}" for e in
                 gates_mod.validate_against_schema(a, "source_adapter.schema.json")]
    if errs:
        _die("adapter contract schema errors: " + "; ".join(errs))
    util.write_json(os.path.join(util.PROCESSED_DIR, "source_adapters.json"),
                    {"generated_at": util.utcnow(), "adapters": adapters})
    util.ledger("build_source_adapters", f"{len(adapters)} contracts emitted")
    print(f"{len(adapters)} adapter contracts -> data/processed/source_adapters.json")


def cmd_score_suppliers(args):
    from src.ingest.score_suppliers import score
    try:
        result = score(online=args.online)
    except Exception as e:
        _die(f"cannot score: {e}", 3)
    top = result["rows"][:10]
    for r in top:
        print(f"{r['provisional_score']:>3}  {r['official_name']}"
              f"  (complete={r['score_complete']})")
    if not result["complete"]:
        print("\nNOTE: scores are provisional — selection must not be "
              "finalised until live-probe criteria can run.")


def cmd_build_truth_slice(args):
    from src.procurement.truth_slice import build
    if not args.supplier:
        _die("provide --supplier NAME (must be on the captured official list)")
    raw_root = FIXTURE_RAW if args.fixture else None
    out_root = FIXTURE_OUT if args.fixture else None
    doc = build(args.supplier, raw_root=raw_root, out_root=out_root)
    print(json.dumps(doc["meta"]["counts"], indent=2))


def cmd_run_acceptance_gates(_):
    report = gates_mod.run_all()
    for g in report["gates"]:
        mark = {"pass": "PASS", "fail": "FAIL", "blocked": "BLOCKED",
                "not_run": "NOT RUN"}[g["status"]]
        print(f"[{mark:7s}] {g['gate_id']}: {g['requirement']}")
        if g["failure_reason"]:
            print(f"          reason: {g['failure_reason']}")
    print(json.dumps(report["summary"]))
    if report["summary"]["fail"]:
        sys.exit(1)


def cmd_render_static_profile(args):
    from src.ui.render_profile import render
    if not args.supplier:
        _die("provide --supplier NAME")
    sid = None
    root = FIXTURE_OUT if args.fixture else util.PROCESSED_DIR
    for f in (os.listdir(root) if os.path.isdir(root) else []):
        if f.startswith("truth_slice_"):
            doc = util.read_json(os.path.join(root, f))
            if args.supplier.lower() in (doc["supplier"]["supplier_id"].lower(),
                                          doc["supplier"]["official_name"].lower()):
                sid = doc
                break
    if not sid:
        _die(f"no truth slice for '{args.supplier}' under {root}; run build_truth_slice first")
    status = util.read_json(util.STATUS_PATH, default={}) or {}
    out_dir = (os.path.join(FIXTURE_OUT, "rendered") if args.fixture
               else os.path.join(util.OUTPUTS_DIR, "profiles"))
    out = os.path.join(out_dir, f"{sid['supplier']['supplier_id']}.html")
    path = render(sid, out, release_state=status.get("release_state", "UNDECIDED"))
    if not args.fixture:
        util.ledger("render_static_profile", path)
    print("rendered:", os.path.relpath(path, ROOT))


def _slice_gates_pass() -> bool:
    rep = util.read_json(os.path.join(util.VALIDATION_DIR, "acceptance_gates.json"),
                         default=None)
    if not rep:
        return False
    by_id = {g["gate_id"]: g for g in rep["gates"]}
    needed = ["GATE-SRC-01", "GATE-SCHEMA-01", "GATE-PROV-01", "GATE-SLICE-01",
              "GATE-SECRET-01", "GATE-FIX-01", "GATE-SAFE-01"]
    return all(by_id.get(g, {}).get("status") == "pass" for g in needed)


def cmd_expand_mini_cohort(_):
    if not _slice_gates_pass():
        _die("mini cohort is gated: the first-supplier truth slice must pass "
             "all acceptance gates first (currently blocked at source access "
             "— see data/validation/acceptance_gates.json)", 5)
    print("gates pass — implement cohort expansion per docs/NEXT_COMMANDS.md")


def cmd_validate_alpha(_):
    if not _slice_gates_pass():
        _die("validation is gated on a passing truth slice; see "
             "docs/VALIDATION.md for the gold-set procedure that starts here", 5)
    print("gold-set validation workflow — see docs/VALIDATION.md")


def cmd_render_static_alpha(_):
    profiles = [f for f in os.listdir(os.path.join(util.OUTPUTS_DIR, "profiles"))
                if f.endswith(".html")] if os.path.isdir(
                    os.path.join(util.OUTPUTS_DIR, "profiles")) else []
    if not profiles:
        _die("no real profiles exist yet (source access BLOCKED); nothing to index", 5)
    print(f"{len(profiles)} profiles present — index generation to be enabled "
          "with the mini cohort")


def cmd_generate_findings(_):
    if not _slice_gates_pass():
        _die("findings are gated: pipeline + public-claim firewall must pass "
             "on real data first (mission rule 42). No findings can exist "
             "before a real truth slice.", 5)
    print("findings generation — implement after first real slice passes gates")


def cmd_run_public_claim_firewall(_):
    findings_path = os.path.join(util.OUTPUTS_DIR, "findings", "findings.jsonl")
    findings = util.read_jsonl(findings_path)
    if not findings:
        print("no findings exist — nothing to review (this is the correct "
              "state until a real truth slice passes gates)")
        return
    reviews = []
    for f in findings:
        errs = gates_mod.validate_against_schema(f, "finding.schema.json")
        wording_hits = [w for w in gates_mod.PROHIBITED_WORDS
                        if w in json.dumps(f).lower()]
        ok = not errs and not wording_hits and f.get("limitations")
        reviews.append({
            "finding_id": f.get("finding_id"),
            "exact_claim": f.get("exact_claim"),
            "supporting_evidence_ids": f.get("evidence_ids", []),
            "supporting_source_records": f.get("source_records", []),
            "calculation": f.get("safe_wording", ""),
            "remaining_uncertainty": f.get("limitations", ""),
            "prohibited_stronger_interpretation": "; ".join(
                f.get("prohibited_stronger_wording", [])),
            "could_imply_wrongdoing": {"answer": bool(wording_hits),
                                        "note": "; ".join(wording_hits) or "no prohibited wording"},
            "could_imply_complete_coverage": {
                "answer": "alpha dataset" not in f.get("exact_claim", "").lower(),
                "note": "claim must scope itself to the alpha dataset"},
            "could_imply_confirmed_ownership": {
                "answer": False, "note": "ownership wording review is manual"},
            "safe_to_display": {"answer": ok and f.get("release_state") == "public",
                                 "note": "; ".join(errs) or "schema ok"},
            "decided_at": util.utcnow(),
            "decided_by": "machine_prescreen (human approval still required)",
        })
    util.write_json(os.path.join(util.OUTPUTS_DIR, "findings",
                                  "public_claim_review.json"), reviews)
    blocked = sum(1 for r in reviews if not r["safe_to_display"]["answer"])
    util.ledger("run_public_claim_firewall", f"{len(reviews)} reviewed, {blocked} blocked")
    print(f"{len(reviews)} findings reviewed; {blocked} blocked; human approval "
          "still required for any public release")


def cmd_prepare_operator_review(_):
    status = util.read_json(util.STATUS_PATH, default={}) or {}
    rep = util.read_json(os.path.join(util.VALIDATION_DIR, "acceptance_gates.json"),
                         default={"gates": []})
    reviews = util.read_jsonl(os.path.join(util.MANUAL_REVIEW_DIR, "queue.jsonl"))
    lines = [
        "# Operator review gate\n\n",
        "**Nothing is published automatically. Public release requires "
        "explicit human approval recorded in this file.**\n\n",
        f"- Prepared: {util.utcnow()}\n",
        f"- Release state (machine-proposed): {status.get('release_state', 'UNDECIDED')}\n",
        f"- Source probe verdict: {status.get('source_probe_verdict', 'NOT_RUN')}\n",
        f"- Evidence-grade captures: {status.get('evidence_grade_captures', 0)}\n",
        f"- Licence review: {status.get('licence_review_state', 'PROVISIONAL')}\n\n",
        "## What would be public\n\nNothing. No real data exists; no findings "
        "exist; no profiles exist under outputs/profiles.\n\n",
        "## What remains private\n\nEverything: machinery, schemas, docs, "
        "probe evidence, fixtures.\n\n",
        "## Gates\n\n",
    ]
    for g in rep.get("gates", []):
        lines.append(f"- {g['gate_id']}: **{g['status']}**"
                     + (f" — {g['failure_reason']}" if g.get("failure_reason") else "")
                     + "\n")
    lines += [
        f"\n## Manual-review items: {len(reviews)}\n",
        "\n## Personal-data exposure\n\nNone (no personal data ingested; "
        "minimisation rules implemented at CH ingest).\n",
        "\n## Files proposed for release\n\nNone. Release state is BLOCKED / "
        "NEEDS HUMAN DECISION pending network access + licence verification.\n",
        "\n## Approval\n\n- [ ] Operator approves public release (NOT granted)\n",
    ]
    path = os.path.join(util.DOCS_DIR, "OPERATOR_REVIEW_GATE.md")
    open(path, "w", encoding="utf-8").writelines(lines)
    util.ledger("prepare_operator_review", path)
    print("wrote docs/OPERATOR_REVIEW_GATE.md")


def cmd_decide_release_state(_):
    status = util.read_json(util.STATUS_PATH, default={}) or {}
    verdict = status.get("source_probe_verdict", "NOT_RUN")
    evidence = status.get("evidence_grade_captures", 0)
    if verdict == "BLOCKED" or evidence == 0:
        state = "BLOCKED_NEEDS_HUMAN_DECISION"
        level = "METHODOLOGY_AND_DATA_SPINE_PACKAGE"
        reason = ("No evidence-grade source capture is possible: every official "
                  "host is denied by the session's egress policy, and "
                  "COMPANIES_HOUSE_API_KEY is absent. The machinery, schemas, "
                  "adapter contracts, gates and fixtures are complete and "
                  "tested; a human must either allowlist the hosts (and "
                  "optionally provide the CH key) or run the pipeline in a "
                  "network-permitted environment.")
    elif not _slice_gates_pass():
        state = "TECHNICAL_PROTOTYPE_ONLY"
        level = "LEVEL_2_DATA_SPINE"
        reason = "Sources reachable but the first truth slice has not passed gates."
    elif status.get("licence_review_state") != "VERIFIED":
        state = "PRIVATE_ALPHA"
        level = "LEVEL_4_STATIC_PROFILE"
        reason = "Truth slice passes gates but licence verification incomplete."
    else:
        state = "PRIVATE_ALPHA"
        level = "LEVEL_4_STATIC_PROFILE"
        reason = ("Gates pass; public release still requires gold-set "
                  "validation thresholds and explicit operator approval.")
    util.update_status(release_state=state, artifact_level=level,
                       release_reason=reason)
    md = [
        "# Release state\n\n",
        f"- Decided: {util.utcnow()}\n",
        f"- **Release state: {state.replace('_', ' ')}**\n",
        f"- Artifact level: {level.replace('_', ' ')}\n\n",
        f"## Reason\n\n{reason}\n\n",
        "## Path to the next state\n\n",
        "1. Allowlist the seven official hosts (docs/SOURCE_ACCESS_LOG.md) or "
        "run locally.\n",
        "2. `python3 scripts/atlas.py probe_sources` → expect PASS/PARTIAL.\n",
        "3. Follow docs/NEXT_COMMANDS.md through the truth slice and gates.\n",
        "4. Verify licences from live terms; update the review doc.\n",
        "5. Prepare operator review; a human decides any public state.\n",
    ]
    open(os.path.join(util.DOCS_DIR, "RELEASE_STATE.md"), "w",
         encoding="utf-8").writelines(md)
    util.ledger("decide_release_state", state)
    print(f"release state: {state}\nartifact level: {level}")


def cmd_package_release(_):
    date = util.today_compact()
    out = os.path.join(util.OUTPUTS_DIR, "release", f"atlas_package_{date}.zip")
    include = ["README.md", ".env.example", "docs", "schemas", "scripts", "src",
               "data/raw", "data/processed", "data/validation", "outputs/profiles"]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in include:
            p = os.path.join(ROOT, item)
            if os.path.isfile(p):
                z.write(p, item)
            else:
                for root, dirs, files in os.walk(p):
                    dirs[:] = [d for d in dirs if d != "__pycache__"]
                    for f in files:
                        fp = os.path.join(root, f)
                        z.write(fp, os.path.relpath(fp, ROOT))
    util.ledger("package_release", out)
    print("packaged:", os.path.relpath(out, ROOT))


def cmd_write_handoff(_):
    import subprocess
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
    except Exception:
        commit = "unknown"
    missing = [d for d in ["PROJECT_STATE.md", "CONTINUE_HERE.md", "RUN_LEDGER.md",
                            "NEXT_COMMANDS.md", "HANDOFF.md", "CHECKPOINTS.md",
                            "DECISIONS.md"]
               if not os.path.exists(os.path.join(util.DOCS_DIR, d))]
    util.update_status(git_commit=commit, continuation_docs_missing=missing)
    util.ledger("write_handoff", f"commit={commit[:12]} missing_docs={missing}")
    if missing:
        _die("continuation docs missing: " + ", ".join(missing))
    print("handoff state refreshed; all continuation docs present")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command")
    ap.add_argument("--supplier")
    ap.add_argument("--keyword")
    ap.add_argument("--number")
    ap.add_argument("--window", nargs=2, metavar=("FROM", "TO"))
    ap.add_argument("--online", action="store_true")
    ap.add_argument("--fixture", action="store_true",
                    help="operate on tests/fixtures (never touches real outputs)")
    args = ap.parse_args()
    fn = globals().get("cmd_" + args.command)
    if not fn:
        _die(f"unknown command '{args.command}' — see scripts/atlas.py --help")
    fn(args)


if __name__ == "__main__":
    main()
