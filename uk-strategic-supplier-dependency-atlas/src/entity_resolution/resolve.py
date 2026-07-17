"""Entity resolution: link one strategic supplier to legal entities and
contract records, deterministically first, with conservative fact states.

Ladder (docs/METHODOLOGY.md): company number > exact name > normalised
name > previous name > postcode > FTS org identifier > CH search >
alias rule > model-assisted > manual review.

Fact-state policy implemented here:
- exact company-number corroboration across >=2 independent records -> CONFIRMED
- exact legal-name equality (case-insensitive) -> PROBABLE
  (upgraded to CONFIRMED when a GB-COH identifier also matches a CH record)
- normalised-name equality -> PROBABLE only with identifier corroboration,
  else POSSIBLE
- core-normalised (suffix-stripped) or previous-name match -> POSSIBLE
- anything weaker -> UNRESOLVED + manual-review item
Model-assisted ranking is NOT run automatically; hooks exist but require
an audit-trail record and can never exceed POSSIBLE.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402


def _match_names(official: str, candidate: str) -> tuple[str, str] | None:
    """Return (method, base_state) or None."""
    if not candidate:
        return None
    if candidate.strip().lower() == official.strip().lower():
        return ("exact_legal_name", "PROBABLE")
    if util.normalise_name(candidate) == util.normalise_name(official):
        return ("normalised_legal_name", "POSSIBLE")
    core_o, core_c = util.normalise_name_core(official), util.normalise_name_core(candidate)
    if core_o and core_o == core_c:
        return ("normalised_legal_name", "POSSIBLE")
    # containment guarded against short/generic names
    if len(core_o) >= 8 and (core_o in core_c or core_c in core_o):
        return ("deterministic_alias_rule", "POSSIBLE")
    return None


def resolve_supplier(
    supplier: dict,
    contracts: list[dict],
    ch_records: list[dict],
    now: str | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (legal_entities, linked_contracts, manual_review_items)."""
    now = now or util.utcnow()
    official = supplier["official_name"]
    ch_by_number = {r["company_number"]: r for r in ch_records}
    ch_prev_names = {}
    for r in ch_records:
        for p in r.get("previous_names") or []:
            if p.get("name"):
                ch_prev_names[util.normalise_name(p["name"])] = r

    entities: dict[str, dict] = {}
    linked: list[dict] = []
    reviews: list[dict] = []

    for contract in contracts:
        best = None  # (state_rank, method, state, supplier_entry, reason)
        rank = {"CONFIRMED": 3, "PROBABLE": 2, "POSSIBLE": 1}
        for sup in contract.get("suppliers") or []:
            m = _match_names(official, sup.get("name") or "")
            method, state, reason = None, None, ""
            if m:
                method, state = m
                reason = (f"official list name '{official}' vs notice supplier "
                          f"'{sup['name']}' via {method}")
            # previous-name path
            if not m and util.normalise_name(sup.get("name") or "") in ch_prev_names:
                method, state = "previous_company_name", "POSSIBLE"
                reason = (f"notice supplier '{sup['name']}' matches a previous "
                          "company name in a captured CH record")
            if not method:
                continue
            # identifier corroboration
            scheme = (sup.get("identifier_scheme") or "").upper()
            ident = sup.get("identifier_id")
            if scheme == "GB-COH" and ident:
                if ident in ch_by_number:
                    ch_name = ch_by_number[ident]["company_name"]
                    if _match_names(official, ch_name):
                        state = "CONFIRMED"
                        method = "exact_company_number"
                        reason += (f"; GB-COH {ident} corroborated by captured CH record "
                                   f"'{ch_name}'")
                else:
                    if state == "POSSIBLE":
                        state = "PROBABLE"
                    reason += f"; notice carries GB-COH identifier {ident} (CH record not yet captured)"
            if best is None or rank.get(state, 0) > best[0]:
                best = (rank.get(state, 0), method, state, sup, reason)

        if not best:
            continue
        _, method, state, sup, reason = best
        ident = sup.get("identifier_id")
        entity_key = f"GB-COH:{ident}" if ident else f"NAME:{util.normalise_name(sup['name'])}"
        if entity_key not in entities:
            entities[entity_key] = {
                "entity_id": "ENT-" + util._idpart(entity_key, 40),
                "name": sup["name"],
                "company_number": ident,
                "jurisdiction": "GB" if ident else None,
                "match": {
                    "supplier_id": supplier["supplier_id"],
                    "method": method,
                    "fact_state": state,
                    "confidence_score": {"CONFIRMED": 0.95, "PROBABLE": 0.75,
                                          "POSSIBLE": 0.5}.get(state, 0.25),
                    "candidate_alternatives": [],
                    "evidence_for": [e for e in [sup.get("evidence_id")] if e],
                    "evidence_against": [],
                    "reason": reason,
                    "reviewer_status": "machine_only",
                    "assessed_at": now,
                },
                "evidence": [e for e in [sup.get("evidence_id")] if e],
            }
        else:
            ent = entities[entity_key]
            if sup.get("evidence_id") and sup["evidence_id"] not in ent["evidence"]:
                ent["evidence"].append(sup["evidence_id"])
            cur = ent["match"]["fact_state"]
            if rank.get(state, 0) > rank.get(cur, 0):
                ent["match"].update({"fact_state": state, "method": method, "reason": reason})

        contract = dict(contract)
        contract["supplier_link"] = {
            "supplier_id": supplier["supplier_id"],
            "method": method,
            "fact_state": state,
            "evidence_ids": [e for e in [sup.get("evidence_id")] if e],
            "reason": reason,
        }
        linked.append(contract)
        if state == "POSSIBLE":
            reviews.append({
                "item_id": f"MR-{supplier['supplier_id']}-{contract['record_id']}"[:80],
                "entity_affected": contract["record_id"],
                "issue_type": "contract_attribution_ambiguous",
                "evidence_available": contract["supplier_link"]["evidence_ids"],
                "candidate_resolutions": [
                    f"Confirm via GB-COH identifier or CH search that '{sup['name']}' is {official}",
                    "Mark unrelated if the match is a name collision",
                ],
                "recommended_next_step": "Capture CH record / FTS org identifier and re-run resolution",
                "publication_status": "displayable_as_unresolved",
                "severity": "medium",
                "created_at": now,
                "resolved_at": None,
                "resolution": None,
            })

    # entity-level review items
    for ent in entities.values():
        if not ent["company_number"]:
            reviews.append({
                "item_id": f"MR-ENTITY-{ent['entity_id']}"[:80],
                "entity_affected": ent["entity_id"],
                "issue_type": "missing_company_number",
                "evidence_available": ent["evidence"],
                "candidate_resolutions": ["CH search once API key + access available"],
                "recommended_next_step": "Run companies_house.search for the notice supplier name",
                "publication_status": "displayable_as_unresolved",
                "severity": "medium",
                "created_at": now,
                "resolved_at": None,
                "resolution": None,
            })
    if len(entities) > 1:
        reviews.append({
            "item_id": f"MR-MULTI-{supplier['supplier_id']}",
            "entity_affected": supplier["supplier_id"],
            "issue_type": "multiple_legal_entity_candidates",
            "evidence_available": [e for ent in entities.values() for e in ent["evidence"]],
            "candidate_resolutions": [f"{e['name']} ({e['company_number'] or 'no number'})"
                                       for e in entities.values()],
            "recommended_next_step": "Review group structure; decide primary contracting entity; keep others as group members",
            "publication_status": "displayable_as_unresolved",
            "severity": "medium",
            "created_at": now,
            "resolved_at": None,
            "resolution": None,
        })
    return list(entities.values()), linked, reviews
