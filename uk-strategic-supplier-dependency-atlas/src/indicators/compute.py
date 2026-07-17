"""Neutral dependency indicators. Every indicator carries its formula,
inputs, evidence IDs, limitations, confidence and a safe-to-display
reason. No subjective risk scores; wording rules in
docs/PUBLICATION_SAFETY.md.

Headline indicators use links at CONFIRMED or PROBABLE; POSSIBLE links are
counted separately and never mixed in.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

HEADLINE_STATES = {"CONFIRMED", "PROBABLE"}


def _mk(supplier_id: str, name: str, formula: str, inputs: list[str],
        records: list[str], evidence: list[str], value, unit, limitations: str,
        confidence: str, safe_reason: str, now: str) -> dict:
    return {
        "indicator_id": f"IND-{supplier_id}-{util._idpart(name, 40)}",
        "name": name,
        "subject_type": "StrategicSupplier",
        "subject_id": supplier_id,
        "formula": formula,
        "input_fields": inputs,
        "input_record_ids": records,
        "evidence_ids": evidence,
        "value": value,
        "unit": unit,
        "limitations": limitations,
        "confidence": confidence,
        "calculated_at": now,
        "safe_to_display_reason": safe_reason,
    }


def _parse_date(s):
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def compute(supplier: dict, linked_contracts: list[dict]) -> list[dict]:
    now = util.utcnow()
    sid = supplier["supplier_id"]
    dataset_note = ("Computed over notices linked in THIS alpha dataset only; "
                    "published-notice visibility is not a complete measure of "
                    "public-sector activity or dependence.")

    head = [c for c in linked_contracts
            if c.get("supplier_link", {}).get("fact_state") in HEADLINE_STATES]
    poss = [c for c in linked_contracts
            if c.get("supplier_link", {}).get("fact_state") == "POSSIBLE"]
    rec_ids = [c["record_id"] for c in head]
    ev_ids = sorted({e for c in head for e in
                     (c.get("supplier_link", {}).get("evidence_ids") or [])})

    out = [
        _mk(sid, "linked_contract_count",
            "count(linked contracts with fact_state in {CONFIRMED, PROBABLE})",
            ["supplier_link.fact_state"], rec_ids, ev_ids, len(head), "notices",
            dataset_note, "CONFIRMED" if head else "UNRESOLVED",
            "Pure count of evidenced links; no interpretation attached.", now),
        _mk(sid, "possible_links_count",
            "count(linked contracts with fact_state == POSSIBLE)",
            ["supplier_link.fact_state"], [c["record_id"] for c in poss],
            sorted({e for c in poss for e in (c.get("supplier_link", {}).get("evidence_ids") or [])}),
            len(poss), "notices",
            "Candidate matches pending review; excluded from all headline figures.",
            "POSSIBLE" if poss else "UNRESOLVED",
            "Transparency metric for unresolved workload.", now),
    ]

    values = [(c, c.get("value") or {}) for c in head]
    gbp = [(c, v) for c, v in values
           if v.get("amount") is not None and (v.get("currency") or "GBP") == "GBP"]
    total = sum(v["amount"] for _, v in gbp)
    out.append(_mk(
        sid, "visible_contract_value_gbp",
        "sum(award value.amount where currency==GBP over headline-linked notices)",
        ["value.amount", "value.currency"],
        [c["record_id"] for c, _ in gbp],
        [v["evidence_id"] for _, v in gbp if v.get("evidence_id")],
        total, "GBP",
        f"{len(head) - len(gbp)} of {len(head)} linked notices have no usable "
        "GBP value and are excluded. Published values may be estimates or "
        f"ceilings. {dataset_note}",
        "PROBABLE" if gbp else "UNRESOLVED",
        "Sum of source-published values only, labelled 'visible'.", now))

    buyers = Counter(util.normalise_name((c.get("buyer") or {}).get("name") or "")
                     for c in head)
    buyers.pop("", None)
    out.append(_mk(
        sid, "buyer_authority_count",
        "count(distinct normalised buyer names over headline-linked notices)",
        ["buyer.name"], rec_ids,
        [b.get("evidence_id") for c in head for b in [c.get("buyer") or {}]
         if b.get("evidence_id")],
        len(buyers), "buyer authorities",
        "Buyer names are not canonicalised across sources; duplicates under "
        f"different spellings may over- or under-count. {dataset_note}",
        "PROBABLE" if buyers else "UNRESOLVED",
        "Count of distinct named buyers in evidence.", now))

    cpv_divisions = sorted({(c_item.get("code") or "")[:2]
                            for c in head for c_item in (c.get("cpv") or [])
                            if c_item.get("code")})
    out.append(_mk(
        sid, "service_category_count",
        "count(distinct CPV 2-digit divisions over headline-linked notices)",
        ["cpv.code"], rec_ids, [], len(cpv_divisions), "CPV divisions",
        f"CPV coding quality varies by buyer. {dataset_note}",
        "PROBABLE" if cpv_divisions else "UNRESOLVED",
        "Standard classification counts only.", now))

    if buyers and total > 0:
        by_buyer = Counter()
        for c, v in gbp:
            by_buyer[util.normalise_name((c.get("buyer") or {}).get("name") or "")] += v["amount"]
        top_name, top_val = (by_buyer.most_common(1)[0] if by_buyer else ("", 0))
        share = round(top_val / total, 4) if total else None
        out.append(_mk(
            sid, "buyer_concentration_top_share",
            "max(buyer visible GBP value) / total visible GBP value",
            ["buyer.name", "value.amount"], [c["record_id"] for c, _ in gbp],
            [v["evidence_id"] for _, v in gbp if v.get("evidence_id")],
            share, "share of visible value",
            f"Value coverage is partial ({len(gbp)}/{len(head)} notices valued); "
            f"top buyer (normalised) = '{top_name}'. {dataset_note}",
            "PROBABLE", "Neutral concentration ratio over published values.", now))

    ends = [(c["record_id"], _parse_date((c.get("dates") or {}).get("end")))
            for c in head]
    ends = [(r, d) for r, d in ends if d]
    if ends:
        best_share, best_window = 0.0, None
        dates = sorted(d for _, d in ends)
        for d in dates:
            hi = d.replace(year=d.year + 1)
            n = sum(1 for _, e in ends if d <= e < hi)
            share = n / len(ends)
            if share > best_share:
                best_share, best_window = share, (d.isoformat(), hi.isoformat())
        out.append(_mk(
            sid, "expiry_clustering",
            "max over rolling 12-month windows of share(linked contracts with "
            "end date in window), among contracts with an end date",
            ["dates.end"], [r for r, _ in ends], [],
            {"share": round(best_share, 4), "window": best_window,
             "contracts_with_end_date": len(ends)}, None,
            f"Only {len(ends)}/{len(head)} linked notices publish an end date; "
            f"extensions/terminations not visible. {dataset_note}",
            "POSSIBLE", "Descriptive clustering of published end dates.", now))

    procs = [c for c in head if c.get("procedure_type")]
    direct = [c for c in procs if str(c["procedure_type"]).lower() in ("direct", "limited")]
    if procs:
        out.append(_mk(
            sid, "direct_award_share",
            "count(procurementMethod in {direct, limited}) / count(notices with "
            "procurementMethod present)",
            ["procedure_type"], [c["record_id"] for c in procs], [],
            round(len(direct) / len(procs), 4), "share",
            f"Only {len(procs)}/{len(head)} linked notices publish a procedure "
            "type; OCDS 'limited' covers several lawful routes. "
            "This is a source-supported procedural statistic, not an "
            f"assessment. {dataset_note}",
            "PROBABLE", "Directly derived from the source's own procedure field.", now))

    missing = 0
    for c in head:
        v = c.get("value") or {}
        has_ident = any(s.get("identifier_id") for s in c.get("suppliers") or [])
        if v.get("amount") is None or not (c.get("dates") or {}).get("end") or not has_ident:
            missing += 1
    out.append(_mk(
        sid, "missing_data_score",
        "share(headline-linked notices missing any of: value, end date, "
        "supplier identifier)",
        ["value.amount", "dates.end", "suppliers.identifier_id"], rec_ids, [],
        round(missing / len(head), 4) if head else None, "share",
        "Higher means weaker records, not worse behaviour.",
        "CONFIRMED" if head else "UNRESOLVED",
        "Data-quality transparency metric.", now))

    confirmed = sum(1 for c in head
                    if c["supplier_link"]["fact_state"] == "CONFIRMED")
    out.append(_mk(
        sid, "evidence_confidence_score",
        "share(headline links at CONFIRMED)",
        ["supplier_link.fact_state"], rec_ids, ev_ids,
        round(confirmed / len(head), 4) if head else None, "share",
        "Reflects evidence strength of the linkage itself.",
        "CONFIRMED" if head else "UNRESOLVED",
        "Meta-metric on the atlas's own evidence.", now))
    return out
