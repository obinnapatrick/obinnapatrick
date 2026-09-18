"""OCDS release-package normalisation shared by FTS and Contracts Finder.

Input: saved raw release-package JSON files (data/raw/procurement/ or a
fixture raw root). Output: ContractRecord dicts (schemas/contract.schema.json)
plus SourceEvidence records for every extracted field.

Field mappings follow the OCDS 1.1 core structure; mappings must be
re-verified against live FTS/CF payloads on first unblocked run (see
docs/SOURCE_ADAPTERS.md). Unknown/absent fields are recorded as absent —
never guessed.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

NOTICE_URL_TEMPLATES = {
    # Human notice pages; templates to re-verify against live services.
    "FAT": "https://www.find-tender.service.gov.uk/Notice/{notice_id}",
    "CF": "https://www.contractsfinder.service.gov.uk/notice/{notice_id}",
}


def _is_fixture(package: dict, meta: dict | None) -> bool:
    return bool(package.get("SYNTHETIC_TEST_FIXTURE") or (meta or {}).get("SYNTHETIC_TEST_FIXTURE"))


def _ev_prefix(fixture: bool) -> str:
    return "FIXTURE" if fixture else "SRC"


def make_evidence(
    *,
    fixture: bool,
    source: str,
    date_compact: str,
    record_id: str,
    field: str,
    source_url: str,
    raw_path: str,
    json_pointer: str,
    value,
    retrieved_at: str,
    transformation: str = "none",
    provenance: str = "DIRECT_OBSERVATION",
    fact_state: str = "CONFIRMED",
) -> dict:
    eid = util.evidence_id(source, date_compact, record_id, field)
    if fixture:
        eid = "FIXTURE-" + eid[len("SRC-"):]
    return {
        "evidence_id": eid,
        "source": source,
        "source_name": {"FAT": "Find a Tender OCDS", "CF": "Contracts Finder",
                        "GOVUK": "GOV.UK", "CH": "Companies House"}.get(source, source),
        "source_url": source_url,
        "source_identifier": record_id,
        "raw_path": raw_path,
        "json_pointer": json_pointer,
        "field": field,
        "extracted_value": value,
        "retrieved_at": retrieved_at,
        "transformation": transformation,
        "provenance_class": provenance,
        "evidence_class": "SYNTHETIC_TEST_FIXTURE" if fixture else "EVIDENCE",
        "fact_state": fact_state,
        "contradiction_status": None,
        "notes": "",
    }


def _party_index(release: dict) -> dict:
    idx = {}
    for i, party in enumerate(release.get("parties") or []):
        pid = party.get("id")
        if pid is not None:
            idx[str(pid)] = (i, party)
    return idx


def _cpv_from(release: dict) -> list[dict]:
    out, seen = [], set()
    tender = release.get("tender") or {}
    candidates = []
    cls = tender.get("classification")
    if cls:
        candidates.append(("/tender/classification", cls))
    for j, item in enumerate(tender.get("items") or []):
        icls = item.get("classification")
        if icls:
            candidates.append((f"/tender/items/{j}/classification", icls))
    for pointer, c in candidates:
        code = str(c.get("id") or "").strip()
        if code and code not in seen:
            seen.add(code)
            out.append({"code": code, "description": c.get("description"), "_pointer": pointer})
    return out


def normalise_release_package(
    package: dict,
    *,
    source: str,
    raw_relpath: str,
    meta: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """Return (contract_records, evidence_records) for one release package."""
    fixture = _is_fixture(package, meta)
    retrieved_at = (meta or {}).get("saved_at") or util.utcnow()
    date_compact = retrieved_at[:10].replace("-", "")
    package_url = (meta or {}).get("source_url") or package.get("uri") or ""

    contracts: list[dict] = []
    evidence: list[dict] = []

    for r_i, release in enumerate(package.get("releases") or []):
        ocid = release.get("ocid")
        release_id = release.get("id")
        record_id = str(ocid or release_id or f"{raw_relpath}#r{r_i}")
        base_ptr = f"/releases/{r_i}"
        tender = release.get("tender") or {}
        parties = _party_index(release)

        def ev(field: str, pointer: str, value, transformation="none",
               provenance="DIRECT_OBSERVATION"):
            rec = make_evidence(
                fixture=fixture, source=source, date_compact=date_compact,
                record_id=record_id, field=field, source_url=package_url,
                raw_path=raw_relpath, json_pointer=pointer, value=value,
                retrieved_at=retrieved_at, transformation=transformation,
                provenance=provenance,
            )
            evidence.append(rec)
            return rec["evidence_id"]

        # Buyer
        buyer = release.get("buyer") or {}
        buyer_name = buyer.get("name")
        buyer_ptr = f"{base_ptr}/buyer/name"
        if not buyer_name:
            for pid, (p_i, party) in parties.items():
                if "buyer" in (party.get("roles") or []):
                    buyer_name = party.get("name")
                    buyer_ptr = f"{base_ptr}/parties/{p_i}/name"
                    break
        buyer_rec = {"name": buyer_name or "UNKNOWN", "identifier": buyer.get("id")}
        if buyer_name:
            buyer_rec["evidence_id"] = ev("BUYER_NAME", buyer_ptr, buyer_name)

        # Title
        title = tender.get("title") or release.get("title") or "(untitled notice)"
        title_ev = ev("TITLE", f"{base_ptr}/tender/title", title)

        # Stage
        tags = release.get("tag") or []
        stage = ("award" if "award" in tags else
                 "contract" if "contract" in tags else
                 "tender" if "tender" in tags else
                 "planning" if "planning" in tags else "unknown")

        # Suppliers, value, dates from awards
        suppliers, value_obj, dates = [], {}, {}
        dates["published"] = release.get("date")
        if release.get("date"):
            ev("PUBLISHED_DATE", f"{base_ptr}/date", release["date"])
        for a_i, award in enumerate(release.get("awards") or []):
            a_ptr = f"{base_ptr}/awards/{a_i}"
            if award.get("date") and not dates.get("award"):
                dates["award"] = award["date"]
                ev("AWARD_DATE", f"{a_ptr}/date", award["date"])
            val = award.get("value") or {}
            if val.get("amount") is not None and not value_obj:
                value_obj = {
                    "amount": val.get("amount"),
                    "currency": val.get("currency"),
                    "evidence_id": ev("VALUE_AMOUNT", f"{a_ptr}/value/amount",
                                       val.get("amount")),
                }
            period = award.get("contractPeriod") or {}
            if period.get("startDate") and not dates.get("start"):
                dates["start"] = period["startDate"]
                ev("CONTRACT_START", f"{a_ptr}/contractPeriod/startDate", period["startDate"])
            if period.get("endDate") and not dates.get("end"):
                dates["end"] = period["endDate"]
                ev("CONTRACT_END", f"{a_ptr}/contractPeriod/endDate", period["endDate"])
            for s_i, sup in enumerate(award.get("suppliers") or []):
                s_ptr = f"{a_ptr}/suppliers/{s_i}"
                name = sup.get("name")
                scheme = ident = None
                pid = str(sup.get("id")) if sup.get("id") is not None else None
                if pid and pid in parties:
                    p_i, party = parties[pid]
                    pident = party.get("identifier") or {}
                    scheme, ident = pident.get("scheme"), pident.get("id")
                    if not name:
                        name = party.get("name")
                    if scheme and ident:
                        ev("SUPPLIER_IDENTIFIER",
                           f"{base_ptr}/parties/{p_i}/identifier/id",
                           f"{scheme}:{ident}")
                if name:
                    suppliers.append({
                        "name": name,
                        "identifier_scheme": scheme,
                        "identifier_id": str(ident) if ident is not None else None,
                        "evidence_id": ev("SUPPLIER_NAME", f"{s_ptr}/name", name),
                    })

        # Procedure
        procedure = tender.get("procurementMethod")
        if procedure:
            ev("PROCEDURE_TYPE", f"{base_ptr}/tender/procurementMethod", procedure)

        # CPV
        cpv = []
        for c in _cpv_from(release):
            pointer = c.pop("_pointer")
            ev("CPV_CODE", f"{base_ptr}{pointer}/id", c["code"])
            cpv.append(c)

        notice_id = str(release_id or ocid or record_id)
        contracts.append({
            "record_id": record_id,
            "source": source,
            "ocid": ocid,
            "title": title,
            "title_evidence_id": title_ev,
            "description": tender.get("description"),
            "stage": stage,
            "buyer": buyer_rec,
            "suppliers": suppliers,
            "value": value_obj,
            "dates": dates,
            "procedure_type": procedure,
            "cpv": cpv,
            "notice_url": NOTICE_URL_TEMPLATES[source].format(notice_id=notice_id),
            "evidence": [e["evidence_id"] for e in evidence
                         if e["source_identifier"] == record_id],
            "raw_path": raw_relpath,
            "fixture": fixture,
        })
    return contracts, evidence
