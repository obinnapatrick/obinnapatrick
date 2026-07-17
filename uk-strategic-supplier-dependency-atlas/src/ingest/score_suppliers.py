"""Supplier-selection scoring (Phase 2).

HARD PRECONDITION: the official GOV.UK strategic supplier list must exist
as a saved raw capture. Suppliers are never scored from memory.

Scores each captured supplier on the 10 selection criteria. Criteria that
need live probing (Contracts Finder visibility) use fetch_keyword captures;
in offline mode those criteria score from already-saved captures or are
marked unknown. Output: data/processed/supplier_selection.json + a scored
markdown table for docs/DECISIONS.md.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.ingest import govuk_strategic_suppliers as govuk  # noqa: E402
from src.ingest import contracts_finder as cf  # noqa: E402

GENERIC_TOKENS = {"group", "uk", "systems", "services", "solutions", "international",
                  "technology", "consulting", "holdings", "national", "british"}


def _name_ambiguity(name: str) -> int:
    """0 (distinctive) .. 3 (very ambiguous). Deterministic heuristic."""
    core = util.normalise_name_core(name)
    tokens = [t for t in core.split() if t]
    score = 0
    if len(core) <= 3:
        score += 2
    if tokens and all(t in GENERIC_TOKENS or len(t) <= 2 for t in tokens):
        score += 2
    if any(t in GENERIC_TOKENS for t in tokens):
        score += 1
    return min(score, 3)


def score(online: bool = False, raw_root: str | None = None) -> dict:
    suppliers, _ = govuk.parse_offline(raw_root)  # raises if no capture
    rows = []
    for s in suppliers:
        name = s["official_name"]
        slug = __import__("re").sub(r"[^a-z0-9]+", "_", name.lower())[:40]
        if online:
            try:
                cf.fetch_keyword(name, size=10)
                time.sleep(util.DEFAULT_DELAY)
            except Exception as e:
                util.ledger("score_probe_failed", f"{name}: {e}")
        hits = cf.keyword_hit_count(raw_root, slug)
        ambiguity = _name_ambiguity(name)
        visibility = None if hits is None else (0 if hits == 0 else 1 if hits < 5
                                                 else 2 if hits < 50 else 3)
        row = {
            "supplier_id": s["supplier_id"],
            "official_name": name,
            "criteria": {
                "source_clarity": 3,  # all rows come from the captured official list
                "entity_matchability": 3 - ambiguity,
                "ch_evidence_availability": None,  # requires CH access; unknown
                "procurement_visibility": visibility,
                "record_richness": visibility,  # proxy until OCDS capture exists
                "ownership_evidence_availability": None,  # requires CH PSC
                "name_ambiguity_inverse": 3 - ambiguity,
                "profile_complexity_penalty": None,  # needs group-structure look
                "truth_slice_fit": None,
                "failure_mode_value": None,
            },
            "cf_keyword_hits": hits,
            "notes": [],
        }
        known = [v for v in row["criteria"].values() if isinstance(v, int)]
        row["provisional_score"] = sum(known)
        row["score_complete"] = all(v is not None for v in row["criteria"].values())
        rows.append(row)

    rows.sort(key=lambda r: (-r["provisional_score"], r["official_name"]))
    result = {
        "generated_at": util.utcnow(),
        "list_source": suppliers[0]["source_list"] if suppliers else None,
        "online_probing_used": online,
        "complete": all(r["score_complete"] for r in rows),
        "note": ("Scores are PROVISIONAL until Contracts Finder visibility and "
                 "Companies House criteria can be probed live. Selection must "
                 "not be finalised on provisional scores alone."),
        "rows": rows,
    }
    util.write_json(os.path.join(util.PROCESSED_DIR, "supplier_selection.json"), result)
    util.ledger("score_suppliers", f"{len(rows)} suppliers scored (online={online})")
    return result
