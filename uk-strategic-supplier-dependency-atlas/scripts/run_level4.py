#!/usr/bin/env python3
"""Level-4 orchestrator: blocked repository -> one real static supplier
profile, in restartable stages.

Usage:
  python scripts/run_level4.py                 full run
  python scripts/run_level4.py --resume        skip already-completed stages
  python scripts/run_level4.py --supplier "X"  operator-chosen supplier
                                               (must be on the captured list)
  python scripts/run_level4.py --fts-months N  FTS harvest depth (default 3)

Stage state lives in data/validation/level4_run.json. A failure preserves
all completed work and prints the exact resume command. Real-data rules:
fixtures can never enter this path (verify stage enforces).

ASCII-only console output for Windows safety.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src import util  # noqa: E402
from src.validation import gates as gates_mod  # noqa: E402
from src.validation.checkpoints import write_checkpoint  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

STATE_PATH = os.path.join(util.VALIDATION_DIR, "level4_run.json")
ATLAS = os.path.join(ROOT, "scripts", "atlas.py")

# stages safe to skip on --resume once completed (fetch/parse/decide-once)
SKIPPABLE = {"probe_sources", "fetch_suppliers", "parse_suppliers",
             "capture_terms", "score_suppliers", "select_supplier",
             "fetch_procurement", "fetch_companies_house"}


class StopRun(Exception):
    """Controlled stop with a message and exit code (state preserved)."""

    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = code


def _state() -> dict:
    return util.read_json(STATE_PATH, default={"stages": {}}) or {"stages": {}}


def _save_state(state: dict) -> None:
    state["updated_at"] = util.utcnow()
    util.write_json(STATE_PATH, state)


def _mark(state: dict, stage: str, status: str, detail: str = "") -> None:
    state["stages"][stage] = {"status": status, "detail": detail,
                              "at": util.utcnow()}
    _save_state(state)


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    proc = subprocess.run([sys.executable, ATLAS, *args], cwd=ROOT,
                          capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout.rstrip())
    if proc.returncode != 0:
        raise StopRun(f"'atlas.py {' '.join(args)}' failed "
                      f"(exit {proc.returncode}): {proc.stderr.strip()[:400]}")
    return proc


def _resume_command(args) -> str:
    cmd = "python scripts/run_level4.py --resume"
    if args.supplier:
        cmd += f' --supplier "{args.supplier}"'
    return cmd


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

def st_preflight(state, args):
    import importlib.util as ilu
    spec = ilu.spec_from_file_location(
        "preflight_local", os.path.join(ROOT, "scripts", "preflight_local.py"))
    mod = ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rep = mod.run()
    if rep["classification"] == "BLOCKED":
        raise StopRun(
            "Preflight classified this machine as BLOCKED - no lawful route "
            "to required real evidence from here. Fix network access (see "
            "docs/LOCAL_TROUBLESHOOTING.md) or use the file-drop fallback "
            "(data/inbox/README.md), then rerun: " + _resume_command(args),
            code=3)
    return rep["classification"]


def st_probe_sources(state, args):
    from src.ingest.probe_sources import run as probe
    rep = probe()
    if rep["verdict"] == "BLOCKED":
        raise StopRun("Full source probe returned BLOCKED despite preflight - "
                      "see data/raw/source_probe/probe_report.json, then rerun: "
                      + _resume_command(args), code=3)
    return f"verdict={rep['verdict']}"


def st_fetch_suppliers(state, args):
    from src.ingest import govuk_strategic_suppliers as govuk
    # reuse today's capture if it already exists (restartability)
    existing = govuk._newest(r"attachment_\d{8}_.*\.(csv|ods)$", util.RAW_DIR)
    if existing and util.today_compact() in os.path.basename(existing):
        return f"reusing today's capture: {os.path.basename(existing)}"
    saved = govuk.fetch()
    return f"saved {len(saved)} raw files"


def st_parse_suppliers(state, args):
    from src.ingest import govuk_strategic_suppliers as govuk
    suppliers, _ = govuk.parse_offline()
    if len(suppliers) < 5:
        raise StopRun(
            f"Only {len(suppliers)} supplier rows parsed from the official "
            "capture - the attachment format has likely changed. Inspect "
            "data/raw/strategic_suppliers/ and extend the parser in "
            "src/ingest/govuk_strategic_suppliers.py (never hand-enter the "
            "list). Then rerun: " + _resume_command(args))
    state["supplier_rows"] = len(suppliers)
    return f"{len(suppliers)} suppliers parsed from official capture"


def st_capture_terms(state, args):
    # best-effort licence/terms captures; failure never stops the run,
    # it only keeps the licence review PROVISIONAL (=> no public state)
    targets = [
        ("terms_govuk_publication",
         "https://www.gov.uk/government/publications/crown-representatives-and-strategic-suppliers"),
        ("terms_fts_apidocs", "https://www.find-tender.service.gov.uk/apidocumentation"),
        ("terms_cf_apidocs", "https://www.contractsfinder.service.gov.uk/apidocumentation/home"),
        ("terms_ogl_v3", "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"),
    ]
    got = 0
    for name, url in targets:
        r = util.http_fetch(url, timeout=30, retries=0)
        if r.get("status") == 200 and r.get("body"):
            util.save_raw(os.path.join("source_probe", f"{name}_{util.today_compact()}.html"),
                          r["body"],
                          {"source_name": name, "source_url": url,
                           "retrieval_method": "HTTP GET", "http_status": 200,
                           "evidence_class": "EVIDENCE"})
            got += 1
        time.sleep(util.DEFAULT_DELAY)
    return (f"captured {got}/{len(targets)} terms pages; licence review must "
            "be updated by hand from these captures (docs/LICENCE_AND_TERMS_REVIEW.md)")


def st_score_suppliers(state, args):
    from src.ingest.score_suppliers import score
    result = score(online=True)
    state["score_rows"] = len(result["rows"])
    return f"scored {len(result['rows'])} suppliers (online probing)"


def st_select_supplier(state, args):
    if args.supplier:
        state["selected_supplier"] = args.supplier
        state["selection_reason"] = "operator override via --supplier"
        _save_state(state)
        return f"operator-selected: {args.supplier}"
    sel = util.read_json(os.path.join(util.PROCESSED_DIR, "supplier_selection.json"),
                         default=None)
    if not sel:
        raise StopRun("supplier_selection.json missing - rerun: "
                      + _resume_command(args))
    candidates = [r for r in sel["rows"]
                  if isinstance(r.get("cf_keyword_hits"), int)
                  and r["cf_keyword_hits"] >= 3
                  and (r["criteria"].get("entity_matchability") or 0) >= 2]
    if not candidates:
        top = [f"  {r['official_name']} (hits={r.get('cf_keyword_hits')})"
               for r in sel["rows"][:8]]
        raise StopRun(
            "No supplier met the automatic selection guardrails "
            "(>=3 Contracts Finder hits and low name ambiguity). Pick one "
            "from the captured list yourself and rerun with:\n  "
            + _resume_command(args) + ' --supplier "<NAME>"\nTop scored rows:\n'
            + "\n".join(top))
    candidates.sort(key=lambda r: (-r["provisional_score"],
                                    -r["cf_keyword_hits"], r["official_name"]))
    chosen = candidates[0]
    decision = {
        "selected_at": util.utcnow(),
        "supplier": chosen["official_name"],
        "supplier_id": chosen["supplier_id"],
        "provisional_score": chosen["provisional_score"],
        "cf_keyword_hits": chosen["cf_keyword_hits"],
        "reason": ("highest provisional score among candidates with >=3 CF "
                   "hits and low name ambiguity - evidence-clean but "
                   "non-trivial per mission rule 12"),
        "runners_up": [{"name": r["official_name"],
                         "score": r["provisional_score"],
                         "hits": r["cf_keyword_hits"]} for r in candidates[1:4]],
    }
    util.write_json(os.path.join(util.PROCESSED_DIR,
                                  "supplier_selection_decision.json"), decision)
    with open(os.path.join(util.DOCS_DIR, "DECISIONS.md"), "a", encoding="utf-8") as f:
        f.write(f"\n## D11 - First supplier selected ({util.utcnow()[:10]})\n\n"
                f"Selected **{chosen['official_name']}** "
                f"(score {chosen['provisional_score']}, CF hits "
                f"{chosen['cf_keyword_hits']}). {decision['reason']}. "
                "Runners-up recorded in data/processed/"
                "supplier_selection_decision.json.\n")
    write_checkpoint("CP4", "supplier shortlist",
                     ["supplier_selection.json", "selection decision + reason"],
                     [], "pass", "python scripts/run_level4.py --resume",
                     f"Selected {chosen['official_name']} per guardrails.")
    state["selected_supplier"] = chosen["official_name"]
    state["selection_reason"] = decision["reason"]
    _save_state(state)
    return f"selected: {chosen['official_name']}"


def _supplier(state, args) -> str:
    name = args.supplier or state.get("selected_supplier")
    if not name:
        raise StopRun("no supplier selected - rerun: python scripts/run_level4.py --resume")
    return name


def _linked_count(name: str) -> int:
    from src.ingest import govuk_strategic_suppliers as govuk
    from src.ingest import find_a_tender as fts
    from src.ingest import contracts_finder as cf
    from src.companies_house import adapter as ch
    from src.entity_resolution.resolve import resolve_supplier
    suppliers, _ = govuk.parse_offline()
    wanted = next((s for s in suppliers
                   if name.lower() in (s["supplier_id"].lower(),
                                        s["official_name"].lower())), None)
    if not wanted:
        raise StopRun(f"'{name}' is not on the captured official list - "
                      "suppliers may only come from the captured GOV.UK list")
    contracts = (fts.load_offline()[0] + cf.load_offline()[0]
                 + cf.load_offline_rest2()[0])
    ch_records, _ = ch.load_offline()
    _, linked, _ = resolve_supplier(wanted, contracts, ch_records)
    return len(linked)


def st_fetch_procurement(state, args):
    from src.ingest import contracts_finder as cf
    from src.ingest import find_a_tender as fts
    name = _supplier(state, args)
    cf.fetch_keyword(name, size=100)
    time.sleep(util.DEFAULT_DELAY)
    linked = _linked_count(name)
    detail = [f"CF keyword capture done; {linked} linkable notices so far"]
    if linked < 3:
        now = dt.datetime.now(dt.timezone.utc)
        for m in range(args.fts_months):
            end = now - dt.timedelta(days=30 * m)
            start = end - dt.timedelta(days=30)
            frm, to = start.strftime("%Y-%m-%dT%H:%M:%S"), end.strftime("%Y-%m-%dT%H:%M:%S")
            try:
                fts.fetch_window(frm, to)
            except Exception as e:
                detail.append(f"FTS window {frm[:10]} failed: {str(e)[:80]}")
            try:
                cf.fetch_window(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            except Exception as e:
                detail.append(f"CF window {frm[:10]} failed: {str(e)[:80]}")
            time.sleep(util.DEFAULT_DELAY)
        linked = _linked_count(name)
        detail.append(f"after window harvest: {linked} linkable notices")
    state["linked_count"] = linked
    _save_state(state)
    return "; ".join(detail)


def st_fetch_companies_house(state, args):
    from src.companies_house import adapter as ch
    from src.ingest import govuk_strategic_suppliers as govuk
    from src.ingest import find_a_tender as fts
    from src.ingest import contracts_finder as cf
    from src.entity_resolution.resolve import resolve_supplier
    name = _supplier(state, args)
    key = os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()
    if not key:
        util.append_jsonl(os.path.join(util.MANUAL_REVIEW_DIR, "queue.jsonl"), {
            "item_id": f"MR-CH-UNAVAILABLE-{util.today_compact()}",
            "entity_affected": name,
            "issue_type": "companies_house_enrichment_unavailable",
            "evidence_available": [],
            "candidate_resolutions": [
                "Obtain a free API key (developer.company-information.service.gov.uk)",
                "Use GB-COH identifiers observed in procurement records (already in use)"],
            "recommended_next_step": "Provide COMPANIES_HOUSE_API_KEY and rerun "
                                      "fetch_companies_house + build_truth_slice",
            "publication_status": "displayable_as_unresolved",
            "severity": "medium",
            "created_at": util.utcnow(),
            "resolved_at": None,
            "resolution": None,
        })
        return ("skipped: COMPANIES_HOUSE_API_KEY absent - documented "
                "limitation recorded; GB-COH identifiers from procurement "
                "data remain in use")
    suppliers, _ = govuk.parse_offline()
    wanted = next(s for s in suppliers
                  if name.lower() in (s["supplier_id"].lower(),
                                       s["official_name"].lower()))
    contracts = (fts.load_offline()[0] + cf.load_offline()[0]
                 + cf.load_offline_rest2()[0])
    entities, _, _ = resolve_supplier(wanted, contracts, [])
    numbers = [e["company_number"] for e in entities if e.get("company_number")]
    fetched = []
    for n in numbers[:3]:
        try:
            ch.fetch_company(n)
            time.sleep(1)
            ch.fetch_psc(n)
            time.sleep(1)
            fetched.append(n)
        except Exception as e:
            print(f"  CH fetch for {n} failed: {str(e)[:100]}")
    if not numbers:
        return ("no GB-COH identifiers observed yet - CH search enrichment "
                "left to manual review (see queue)")
    return f"fetched CH profile+PSC for {fetched or 'none'} of {numbers[:3]}"


def st_lock_sources(state, args):
    _run_cli("lock_sources")
    return "manifest refreshed"


def st_build_truth_slice(state, args):
    from src.procurement.truth_slice import build
    name = _supplier(state, args)
    doc = build(name)
    counts = doc["meta"]["counts"]
    if counts["contracts_linked"] < 3:
        util.append_jsonl(os.path.join(util.MANUAL_REVIEW_DIR, "queue.jsonl"), {
            "item_id": f"MR-FEWLINKS-{doc['supplier']['supplier_id']}",
            "entity_affected": doc["supplier"]["supplier_id"],
            "issue_type": "insufficient_linked_records",
            "evidence_available": [],
            "candidate_resolutions": [
                "Harvest wider FTS/CF windows (--fts-months)",
                "Search trading-name variants via manual review"],
            "recommended_next_step": "Documented reason: keyword + window "
                                      "harvest yielded fewer than 3 linkable "
                                      "notices in the captured windows",
            "publication_status": "displayable_as_unresolved",
            "severity": "medium",
            "created_at": util.utcnow(),
            "resolved_at": None,
            "resolution": None,
        })
    state["slice_counts"] = counts
    state["supplier_id"] = doc["supplier"]["supplier_id"]
    _save_state(state)
    return json.dumps(counts)


def st_acceptance_gates(state, args):
    rep = gates_mod.run_all()
    failed = [g for g in rep["gates"] if g["status"] == "fail"]
    if failed:
        raise StopRun("acceptance gates FAILED: "
                      + "; ".join(f"{g['gate_id']}: {g['failure_reason']}"
                                   for g in failed)
                      + "\nFix and rerun: " + _resume_command(args))
    needed = {"GATE-SCHEMA-01", "GATE-PROV-01"}
    not_pass = [g["gate_id"] for g in rep["gates"]
                if g["gate_id"] in needed and g["status"] != "pass"]
    if not_pass:
        raise StopRun(f"slice gates not passing: {not_pass}; rerun: "
                      + _resume_command(args))
    return json.dumps(rep["summary"])


def st_decide_release_state(state, args):
    _run_cli("decide_release_state")
    return util.read_json(util.STATUS_PATH, default={}).get("release_state", "?")


def st_render_profile(state, args):
    name = _supplier(state, args)
    _run_cli("render_static_profile", "--supplier", name)
    sid = state.get("supplier_id", "")
    path = os.path.join("outputs", "profiles", f"{sid}.html")
    state["profile_path"] = path
    _save_state(state)
    return path


def st_verify_level4(state, args):
    proc = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "verify_level4.py")],
        cwd=ROOT, capture_output=True, text=True)
    print(proc.stdout.rstrip())
    if proc.returncode != 0:
        raise StopRun("Level-4 verification FAILED (failing profile "
                      "quarantined; raw evidence untouched):\n"
                      + proc.stderr.strip()[:600] + "\nFix and rerun: "
                      + _resume_command(args))
    return "all Level-4 invariants pass"


def st_finalize(state, args):
    name = _supplier(state, args)
    counts = state.get("slice_counts", {})
    write_checkpoint("CP6", "one-supplier truth slice",
                     [f"real truth slice for {name}", json.dumps(counts)],
                     [], "pass", "python scripts/verify_level4.py",
                     "Built offline from locked raw captures.")
    write_checkpoint("CP7", "acceptance gates",
                     ["all gates pass or non-blocking"], [], "pass",
                     "python scripts/atlas.py run_acceptance_gates",
                     "Slice gates green on real data.")
    write_checkpoint("CP8", "static profile",
                     [state.get("profile_path", "outputs/profiles/")],
                     [], "pass",
                     "python scripts/atlas.py render_static_profile --supplier "
                     f'"{name}"',
                     "Level 4 reached; verified by scripts/verify_level4.py.")
    _run_cli("write_handoff")
    util.update_status(artifact_level="LEVEL_4_STATIC_PROFILE")
    return "checkpoints + handoff updated"


STAGES = [
    ("preflight", st_preflight),
    ("probe_sources", st_probe_sources),
    ("fetch_suppliers", st_fetch_suppliers),
    ("parse_suppliers", st_parse_suppliers),
    ("capture_terms", st_capture_terms),
    ("score_suppliers", st_score_suppliers),
    ("select_supplier", st_select_supplier),
    ("fetch_procurement", st_fetch_procurement),
    ("fetch_companies_house", st_fetch_companies_house),
    ("lock_sources", st_lock_sources),
    ("build_truth_slice", st_build_truth_slice),
    ("acceptance_gates", st_acceptance_gates),
    ("decide_release_state", st_decide_release_state),
    ("render_profile", st_render_profile),
    ("verify_level4", st_verify_level4),
    ("finalize", st_finalize),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--supplier", default=None)
    ap.add_argument("--fts-months", type=int, default=3)
    args = ap.parse_args()

    state = _state() if args.resume else {"stages": {}}
    if args.resume and _state().get("selected_supplier") and not args.supplier:
        state = _state()
    state.setdefault("stages", {})
    state["run_started_at"] = state.get("run_started_at") or util.utcnow()
    _save_state(state)

    print("=== ATLAS LEVEL-4 LOCAL RUN ===")
    for name, fn in STAGES:
        done = state["stages"].get(name, {}).get("status") == "done"
        if args.resume and done and name in SKIPPABLE:
            print(f"[skip ] {name}: already completed "
                  f"({state['stages'][name]['detail'][:70]})")
            continue
        print(f"[stage] {name} ...")
        try:
            detail = fn(state, args) or ""
            _mark(state, name, "done", detail)
            print(f"[done ] {name}: {detail[:200]}")
        except StopRun as e:
            _mark(state, name, "stopped", str(e)[:400])
            state["last_error"] = f"{name}: {e}"
            state["resume_command"] = _resume_command(args)
            _save_state(state)
            print("\n=== RUN STOPPED (completed work preserved) ===")
            print(str(e))
            print("\nResume with:\n  " + _resume_command(args))
            return e.code
        except Exception as e:
            _mark(state, name, "failed", f"{type(e).__name__}: {e}"[:400])
            state["last_error"] = f"{name}: {type(e).__name__}: {e}"
            state["resume_command"] = _resume_command(args)
            _save_state(state)
            print("\n=== RUN FAILED (completed work preserved) ===")
            print(f"stage '{name}': {type(e).__name__}: {e}")
            print("See docs/LOCAL_TROUBLESHOOTING.md.")
            print("\nResume with:\n  " + _resume_command(args))
            return 1

    profile = state.get("profile_path", "outputs/profiles/<supplier_id>.html")
    print("\n=== LEVEL 4 COMPLETE ===")
    print("Static supplier profile: " + profile)
    print("Verification report: data/validation/level4_verification.json")
    print("Next: commit and push, then run the next Fable command in "
          "docs/NEXT_COMMANDS.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
