"""One-supplier truth-slice builder (offline: reads saved raw only).

Assembles: supplier -> legal entities -> CH records -> linked contracts ->
public bodies -> ownership edges -> indicators -> manual review ->
evidence ledger, into data/processed/truth_slice_{supplier_id}.json
(or an alternate output root in fixture mode).
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.ingest import govuk_strategic_suppliers as govuk  # noqa: E402
from src.ingest import find_a_tender as fts  # noqa: E402
from src.ingest import contracts_finder as cf  # noqa: E402
from src.companies_house import adapter as ch  # noqa: E402
from src.entity_resolution.resolve import resolve_supplier  # noqa: E402
from src.indicators.compute import compute as compute_indicators  # noqa: E402
from src.ownership.edges import build_edges  # noqa: E402


def build(supplier_name_or_id: str, raw_root: str | None = None,
          out_root: str | None = None) -> dict:
    raw_root = raw_root or util.RAW_DIR
    out_root = out_root or util.PROCESSED_DIR
    fixture_mode = raw_root != util.RAW_DIR

    suppliers, sup_ev = govuk.parse_offline(raw_root)
    wanted = None
    for s in suppliers:
        if supplier_name_or_id.lower() in (s["supplier_id"].lower(),
                                            s["official_name"].lower()):
            wanted = s
            break
    if not wanted:
        raise SystemExit(
            f"Supplier '{supplier_name_or_id}' is not on the captured official "
            f"list ({len(suppliers)} rows). Suppliers may only come from the "
            "captured GOV.UK list — never from memory.")

    fts_contracts, fts_ev = fts.load_offline(raw_root)
    cf_contracts, cf_ev = cf.load_offline(raw_root)
    cf2_contracts, cf2_ev = cf.load_offline_rest2(raw_root)
    cf_ev = cf_ev + cf2_ev
    # OCDS-rich records first so they win dedupe over REST2 summaries
    contracts = fts_contracts + cf_contracts + cf2_contracts
    # cross-source dedupe; CF ocids embed the notice id behind the
    # registered "ocds-b5fd17-" prefix, so strip it for comparison
    seen_ocids = set()
    deduped = []
    for c in contracts:
        key = str(c.get("ocid") or c["record_id"]).replace("ocds-b5fd17-", "")
        if key in seen_ocids:
            continue
        seen_ocids.add(key)
        deduped.append(c)

    ch_records, ch_ev = ch.load_offline(raw_root)
    entities, linked, reviews = resolve_supplier(wanted, deduped, ch_records)
    edges, edge_reviews = build_edges(entities, ch_records)
    reviews += edge_reviews
    indicators = compute_indicators(wanted, linked)

    bodies = defaultdict(lambda: {"contract_record_ids": [], "evidence": []})
    for c in linked:
        if c["supplier_link"]["fact_state"] not in ("CONFIRMED", "PROBABLE", "POSSIBLE"):
            continue
        b = c.get("buyer") or {}
        key = util.normalise_name(b.get("name") or "unknown")
        bodies[key]["name"] = b.get("name") or "UNKNOWN"
        bodies[key]["contract_record_ids"].append(c["record_id"])
        if b.get("evidence_id"):
            bodies[key]["evidence"].append(b["evidence_id"])
    public_bodies = [{
        "body_id": "PB-" + util._idpart(k, 40),
        "name": v["name"],
        "identifier": None,
        "contract_record_ids": v["contract_record_ids"],
        "evidence": v["evidence"],
        "fact_state": "CONFIRMED",
    } for k, v in sorted(bodies.items())]

    ch_in_slice = [r for r in ch_records
                   if r["company_number"] in
                   {e.get("company_number") for e in entities}]

    # evidence ledger restricted to this slice
    used_ids = set(wanted["evidence"])
    for coll in (entities, linked, edges, indicators, public_bodies, ch_in_slice):
        for item in coll:
            for key in ("evidence", "evidence_ids"):
                used_ids.update(item.get(key) or [])
            if "supplier_link" in item:
                used_ids.update(item["supplier_link"].get("evidence_ids") or [])
            if "title_evidence_id" in item and item["title_evidence_id"]:
                used_ids.add(item["title_evidence_id"])
            for s in item.get("suppliers", []) if isinstance(item.get("suppliers"), list) else []:
                if s.get("evidence_id"):
                    used_ids.add(s["evidence_id"])
            v = item.get("value") or {}
            if isinstance(v, dict) and v.get("evidence_id"):
                used_ids.add(v["evidence_id"])
            b = item.get("buyer") or {}
            if isinstance(b, dict) and b.get("evidence_id"):
                used_ids.add(b["evidence_id"])
    all_ev = {e["evidence_id"]: e for e in (sup_ev + fts_ev + cf_ev + ch_ev)}
    # contract-level evidence lists reference every field of that record
    for c in linked:
        used_ids.update(c.get("evidence") or [])
    ledger = [all_ev[i] for i in sorted(used_ids) if i in all_ev]

    slice_doc = {
        "supplier": wanted,
        "legal_entities": entities,
        "companies_house_records": ch_in_slice,
        "contracts": linked,
        "public_bodies": public_bodies,
        "ownership_edges": edges,
        "indicators": indicators,
        "manual_review_items": reviews,
        "evidence_ledger": ledger,
        "meta": {
            "built_at": util.utcnow(),
            "fixture_mode": fixture_mode,
            "raw_root": os.path.relpath(raw_root, util.ROOT),
            "offline": True,
            "rebuild_command": ("python3 scripts/atlas.py build_truth_slice "
                                 f"--supplier '{wanted['official_name']}'"
                                 + (" --fixture" if fixture_mode else "")),
            "counts": {"contracts_linked": len(linked),
                        "entities": len(entities),
                        "manual_review": len(reviews),
                        "evidence_records": len(ledger)},
        },
    }
    out_path = os.path.join(out_root, f"truth_slice_{wanted['supplier_id']}.json")
    util.write_json(out_path, slice_doc)
    ledger_path = os.path.join(out_root, "evidence_ledger.jsonl")
    if os.path.exists(ledger_path):
        os.remove(ledger_path)
    for e in ledger:
        util.append_jsonl(ledger_path, e)
    for r in reviews:
        util.append_jsonl(os.path.join(
            out_root if fixture_mode else util.MANUAL_REVIEW_DIR, "queue.jsonl"), r)
    if not fixture_mode:
        util.ledger("build_truth_slice",
                    f"{wanted['supplier_id']}: {len(linked)} linked contracts, "
                    f"{len(entities)} entities, {len(reviews)} review items")
    return slice_doc
