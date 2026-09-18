"""Ownership/control edges from captured Companies House PSC evidence.

Cautious by design: PSC statements produce edges at PROBABLE (official
register, but may lag or name intermediate owners); corporate-entity PSCs
default to org-level display; individual PSCs are included only with
name + natures of control (minimised at ingest) and flagged for
data-minimisation review. Edges never imply wrongdoing.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402


def build_edges(entities: list[dict], ch_records: list[dict]) -> tuple[list[dict], list[dict]]:
    now = util.utcnow()
    ch_by_number = {r["company_number"]: r for r in ch_records}
    edges, reviews = [], []
    for ent in entities:
        num = ent.get("company_number")
        rec = ch_by_number.get(num) if num else None
        if not rec:
            continue
        for i, psc in enumerate(rec.get("psc_summary") or []):
            kind = psc.get("kind") or ""
            is_person = "individual" in kind
            controller = psc.get("name") or "(unnamed PSC)"
            edge = {
                "edge_id": f"OWN-{num}-{i}",
                "from_entity": controller,
                "to_entity": ent["entity_id"],
                "edge_type": "owns_or_controls",
                "natures_of_control": psc.get("natures_of_control") or [],
                "source": "CH",
                "evidence": [e for e in rec.get("evidence", []) if f"PSC_{i}" in e],
                "fact_state": "PROBABLE",
                "evidence_date": psc.get("notified_on"),
                "contradiction_status": None,
                "personal_data_minimisation_applied": True,
                "notes": ("Individual PSC shown name-only per data-minimisation "
                          "policy" if is_person else
                          "Corporate-entity PSC (org-level display)"),
            }
            edges.append(edge)
            if is_person:
                reviews.append({
                    "item_id": f"MR-PSC-{num}-{i}",
                    "entity_affected": ent["entity_id"],
                    "issue_type": "individual_psc_display_review",
                    "evidence_available": edge["evidence"],
                    "candidate_resolutions": [
                        "Display name-only (official public record, necessary for control explanation)",
                        "Suppress individual name; display 'individual PSC on record' only"],
                    "recommended_next_step": "Human publication-safety review before any public display",
                    "publication_status": "blocked_until_resolved",
                    "severity": "high",
                    "created_at": now,
                    "resolved_at": None,
                    "resolution": None,
                })
    return edges, reviews
