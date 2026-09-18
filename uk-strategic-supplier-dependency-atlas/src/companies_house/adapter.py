"""Adapter 4: Companies House public data API (key-aware, minimising).

fetch_company()/fetch_psc()/search(): online captures (need
COMPANIES_HOUSE_API_KEY). load_offline(): parse saved captures into
minimised CompaniesHouseRecord dicts + evidence.

Data minimisation (docs/PUBLICATION_SAFETY.md): residential addresses are
never stored; registered office reduced to locality+postcode; PSC persons
reduced to name + natures of control + notified date (no DOB, no
address). Raw API payloads are saved as returned EXCEPT that
minimisation-sensitive fields are redacted before writing to disk, and
the redaction is recorded in the meta sidecar.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.normalize.ocds import make_evidence  # noqa: E402

BASE = "https://api.company-information.service.gov.uk"
WEB_PROFILE = "https://find-and-update.company-information.service.gov.uk/company/{number}"
RAW_SUBDIR = "companies_house"

REDACT_KEYS = {"date_of_birth", "address", "usual_residential_address"}
KEEP_ADDRESS_KEYS = {"locality", "postal_code", "region", "country"}


class MissingCredential(Exception):
    pass


def _auth_header() -> dict:
    key = os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()
    if not key:
        raise MissingCredential(
            "COMPANIES_HOUSE_API_KEY is not set. Register free at "
            "https://developer.company-information.service.gov.uk/ and export "
            "the key (see .env.example). No fallback fabrication is permitted.")
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode()}


def _minimise(obj, redactions: list[str], path: str = "") -> object:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            p = f"{path}/{k}"
            if k in ("registered_office_address", "service_address", "address"):
                kept = {kk: vv for kk, vv in (v or {}).items() if kk in KEEP_ADDRESS_KEYS}
                redactions.append(f"{p}: reduced to {sorted(kept)}")
                out[k] = kept
            elif k in REDACT_KEYS:
                redactions.append(f"{p}: removed")
            else:
                out[k] = _minimise(v, redactions, p)
        return out
    if isinstance(obj, list):
        return [_minimise(v, redactions, f"{path}/{i}") for i, v in enumerate(obj)]
    return obj


def _save(number: str, kind: str, url: str, body: bytes) -> dict:
    doc = json.loads(body)
    redactions: list[str] = []
    doc = _minimise(doc, redactions)
    data = json.dumps(doc, indent=2, ensure_ascii=False).encode()
    return util.save_raw(
        os.path.join(RAW_SUBDIR, f"{number}_{kind}_{util.today_compact()}.json"), data,
        {"source_name": "Companies House API", "source_url": url,
         "retrieval_method": "HTTP GET (Basic auth, key from env)",
         "http_status": 200, "company_number": number,
         "data_minimisation_redactions": redactions})


def fetch_company(number: str) -> dict:
    url = f"{BASE}/company/{number}"
    r = util.http_fetch(url, headers=_auth_header())
    if r.get("status") == 429:
        time.sleep(5)
        r = util.http_fetch(url, headers=_auth_header())
    if r.get("status") != 200:
        raise RuntimeError(f"CH company fetch failed: {number}: {r.get('error') or r.get('status')}")
    return _save(number, "profile", url, r["body"])


def fetch_psc(number: str) -> dict:
    url = f"{BASE}/company/{number}/persons-with-significant-control"
    r = util.http_fetch(url, headers=_auth_header())
    if r.get("status") != 200:
        raise RuntimeError(f"CH PSC fetch failed: {number}: {r.get('error') or r.get('status')}")
    return _save(number, "psc", url, r["body"])


def search(query: str) -> dict:
    import urllib.parse
    url = f"{BASE}/search/companies?q={urllib.parse.quote(query)}"
    r = util.http_fetch(url, headers=_auth_header())
    if r.get("status") != 200:
        raise RuntimeError(f"CH search failed: {query}: {r.get('error') or r.get('status')}")
    slug = re.sub(r"[^a-z0-9]+", "_", query.lower())[:40]
    return util.save_raw(
        os.path.join(RAW_SUBDIR, f"search_{slug}_{util.today_compact()}.json"), r["body"],
        {"source_name": "Companies House API search", "source_url": url,
         "retrieval_method": "HTTP GET (Basic auth, key from env)", "http_status": 200})


def load_offline(raw_root: str | None = None) -> tuple[list[dict], list[dict]]:
    raw_root = raw_root or util.RAW_DIR
    d = os.path.join(raw_root, RAW_SUBDIR)
    records, evidence = [], []
    if not os.path.isdir(d):
        return records, evidence
    profiles = {}
    pscs = {}
    for fname in sorted(os.listdir(d)):
        m = re.match(r"([A-Za-z0-9]+)_(profile|psc)_(\d{8})\.json$", fname)
        if not m:
            continue
        number, kind, _ = m.groups()
        (profiles if kind == "profile" else pscs)[number] = os.path.join(d, fname)

    for number, path in profiles.items():
        meta = util.read_json(path + ".meta.json", default={}) or {}
        fixture = bool(meta.get("SYNTHETIC_TEST_FIXTURE"))
        doc = util.read_json(path, default={}) or {}
        retrieved_at = meta.get("saved_at") or util.utcnow()
        date_compact = retrieved_at[:10].replace("-", "")
        relpath = os.path.relpath(path, util.ROOT)
        url = meta.get("source_url") or WEB_PROFILE.format(number=number)

        def ev(field, pointer, value):
            rec = make_evidence(
                fixture=fixture, source="CH", date_compact=date_compact,
                record_id=number, field=field, source_url=url,
                raw_path=relpath, json_pointer=pointer, value=value,
                retrieved_at=retrieved_at)
            evidence.append(rec)
            return rec["evidence_id"]

        ev_ids = [ev("COMPANY_NAME", "/company_name", doc.get("company_name")),
                  ev("COMPANY_NUMBER", "/company_number", doc.get("company_number") or number)]
        if doc.get("company_status"):
            ev_ids.append(ev("COMPANY_STATUS", "/company_status", doc["company_status"]))
        if doc.get("date_of_creation"):
            ev_ids.append(ev("DATE_OF_CREATION", "/date_of_creation", doc["date_of_creation"]))
        prev = []
        for i, p in enumerate(doc.get("previous_company_names") or []):
            prev.append({"name": p.get("name"),
                         "effective_from": p.get("effective_from"),
                         "ceased_on": p.get("ceased_on")})
            ev_ids.append(ev("PREVIOUS_NAME", f"/previous_company_names/{i}/name", p.get("name")))

        psc_summary = []
        if number in pscs:
            ppath = pscs[number]
            pmeta = util.read_json(ppath + ".meta.json", default={}) or {}
            pdoc = util.read_json(ppath, default={}) or {}
            prel = os.path.relpath(ppath, util.ROOT)
            for i, item in enumerate(pdoc.get("items") or []):
                psc_summary.append({
                    "kind": item.get("kind"),
                    "name": item.get("name"),
                    "natures_of_control": item.get("natures_of_control") or [],
                    "notified_on": item.get("notified_on"),
                })
                rec = make_evidence(
                    fixture=bool(pmeta.get("SYNTHETIC_TEST_FIXTURE")) or fixture,
                    source="CH", date_compact=date_compact, record_id=number,
                    field=f"PSC_{i}", source_url=pmeta.get("source_url") or url,
                    raw_path=prel, json_pointer=f"/items/{i}",
                    value={"name": item.get("name"),
                           "natures_of_control": item.get("natures_of_control")},
                    retrieved_at=retrieved_at)
                evidence.append(rec)
                ev_ids.append(rec["evidence_id"])

        records.append({
            "company_number": doc.get("company_number") or number,
            "company_name": doc.get("company_name") or "(unknown)",
            "company_status": doc.get("company_status"),
            "company_type": doc.get("type"),
            "date_of_creation": doc.get("date_of_creation"),
            "registered_office": {
                "locality": (doc.get("registered_office_address") or {}).get("locality"),
                "postal_code": (doc.get("registered_office_address") or {}).get("postal_code"),
            },
            "previous_names": prev,
            "sic_codes": doc.get("sic_codes") or [],
            "psc_summary": psc_summary,
            "retrieved_at": retrieved_at,
            "raw_path": relpath,
            "evidence": ev_ids,
            "fixture": fixture,
            "web_profile_url": WEB_PROFILE.format(number=number),
        })
    return records, evidence
