"""Adapter 3: Contracts Finder.

fetch_keyword(): REST v2 keyword search (discovery + visibility probing),
saved raw. fetch_window(): OCDS harvester date window, saved raw.
load_offline(): parse saved CF OCDS packages into contract records +
evidence.

Endpoints follow the documented public Contracts Finder APIs and must be
re-verified live (docs/SOURCE_ADAPTERS.md). Keyword-search responses are
used for discovery only; atlas facts are normalised from OCDS payloads.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.normalize.ocds import normalise_release_package  # noqa: E402

SEARCH_V2 = "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json"
OCDS_SEARCH = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"
RAW_SUBDIR = "procurement"


def fetch_keyword(keyword: str, size: int = 50) -> dict:
    q = urllib.parse.urlencode({"keyword": keyword, "size": size})
    url = f"{SEARCH_V2}?{q}"
    r = util.http_fetch(url)
    if r.get("status") != 200:
        raise RuntimeError(f"CF keyword fetch failed: {keyword}: {r.get('error') or r.get('status')}")
    slug = re.sub(r"[^a-z0-9]+", "_", keyword.lower())[:40]
    return util.save_raw(
        os.path.join(RAW_SUBDIR, f"cf_search_{slug}_{util.today_compact()}.json"),
        r["body"],
        {"source_name": "Contracts Finder REST v2 search", "source_url": url,
         "retrieval_method": "HTTP GET", "http_status": 200, "keyword": keyword})


def fetch_window(published_from: str, published_to: str, limit: int = 100) -> dict:
    q = urllib.parse.urlencode({"publishedFrom": published_from,
                                 "publishedTo": published_to, "limit": limit})
    url = f"{OCDS_SEARCH}?{q}"
    r = util.http_fetch(url)
    if r.get("status") != 200:
        raise RuntimeError(f"CF OCDS window fetch failed: {r.get('error') or r.get('status')}")
    return util.save_raw(
        os.path.join(RAW_SUBDIR, f"cf_ocds_{util.today_compact()}_{published_from}_{published_to}.json"),
        r["body"],
        {"source_name": "Contracts Finder OCDS search", "source_url": url,
         "retrieval_method": "HTTP GET", "http_status": 200,
         "window": [published_from, published_to]})


def load_offline(raw_root: str | None = None) -> tuple[list[dict], list[dict]]:
    raw_root = raw_root or util.RAW_DIR
    d = os.path.join(raw_root, RAW_SUBDIR)
    contracts, evidence = [], []
    if not os.path.isdir(d):
        return contracts, evidence
    for fname in sorted(os.listdir(d)):
        if not re.match(r"cf_ocds_.*\.json$", fname) or fname.endswith(".meta.json"):
            continue
        path = os.path.join(d, fname)
        meta = util.read_json(path + ".meta.json", default={}) or {}
        try:
            package = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            util.ledger("cf_parse_failed", f"{fname}: {e}")
            continue
        relpath = os.path.relpath(path, util.ROOT)
        c, e = normalise_release_package(package, source="CF",
                                          raw_relpath=relpath, meta=meta)
        contracts.extend(c)
        evidence.extend(e)
    return contracts, evidence


def keyword_hit_count(raw_root: str | None = None, keyword_slug: str = "") -> int | None:
    """Count hits in a saved keyword-search capture (discovery metric only)."""
    raw_root = raw_root or util.RAW_DIR
    d = os.path.join(raw_root, RAW_SUBDIR)
    if not os.path.isdir(d):
        return None
    matches = sorted(f for f in os.listdir(d)
                     if f.startswith(f"cf_search_{keyword_slug}_") and f.endswith(".json")
                     and not f.endswith(".meta.json"))
    if not matches:
        return None
    doc = util.read_json(os.path.join(d, matches[-1]), default={}) or {}
    for key in ("hitOfNoticesTotal", "total", "totalResults", "noticeCount"):
        if isinstance(doc.get(key), int):
            return doc[key]
    lst = doc.get("noticeList") or doc.get("results") or []
    return len(lst) if isinstance(lst, list) else None


# ---------------------------------------------------------------------------
# REST v2 keyword-search parsing (defensive secondary path)
# ---------------------------------------------------------------------------
# The REST2 search response is an official Contracts Finder payload, so
# fields extracted from it are DIRECT_OBSERVATION evidence — but its exact
# shape must be confirmed against a live response. This parser maps only
# fields it can positively identify and returns [] (never guesses) for
# unrecognised structures; the orchestrator then falls back to OCDS window
# harvesting and records a manual-review item.

_REST2_LIST_KEYS = ("noticeList", "results", "notices", "releases")


def _rest2_items(doc: dict) -> tuple[str, list]:
    for key in _REST2_LIST_KEYS:
        lst = doc.get(key)
        if isinstance(lst, list) and lst:
            return key, lst
    return "", []


def _rest2_field(item: dict, *names):
    for n in names:
        if item.get(n) not in (None, ""):
            return item[n], n
    return None, None


def load_offline_rest2(raw_root: str | None = None) -> tuple[list[dict], list[dict]]:
    """Parse saved cf_search_* keyword captures into contract records."""
    from src.normalize.ocds import make_evidence

    raw_root = raw_root or util.RAW_DIR
    d = os.path.join(raw_root, RAW_SUBDIR)
    contracts, evidence = [], []
    if not os.path.isdir(d):
        return contracts, evidence
    for fname in sorted(os.listdir(d)):
        if not fname.startswith("cf_search_") or not fname.endswith(".json") \
                or fname.endswith(".meta.json"):
            continue
        path = os.path.join(d, fname)
        meta = util.read_json(path + ".meta.json", default={}) or {}
        fixture = bool(meta.get("SYNTHETIC_TEST_FIXTURE"))
        doc = util.read_json(path, default={}) or {}
        retrieved_at = meta.get("saved_at") or util.utcnow()
        date_compact = retrieved_at[:10].replace("-", "")
        relpath = os.path.relpath(path, util.ROOT)
        list_key, items = _rest2_items(doc)
        for i, wrapper in enumerate(items):
            item = wrapper.get("item") if isinstance(wrapper.get("item"), dict) else wrapper
            base_ptr = (f"/{list_key}/{i}/item" if wrapper is not item
                        else f"/{list_key}/{i}")
            notice_id, _ = _rest2_field(item, "id", "noticeIdentifier", "noticeId")
            title, title_key = _rest2_field(item, "title", "noticeTitle")
            buyer, buyer_key = _rest2_field(item, "organisationName", "buyerName",
                                             "organisation")
            if not notice_id or not title or not buyer:
                continue  # cannot positively identify -> skip, never guess
            record_id = str(notice_id)

            def ev(field, key, value):
                rec = make_evidence(
                    fixture=fixture, source="CF", date_compact=date_compact,
                    record_id=record_id, field=field,
                    source_url=meta.get("source_url", ""), raw_path=relpath,
                    json_pointer=f"{base_ptr}/{key}", value=value,
                    retrieved_at=retrieved_at)
                evidence.append(rec)
                return rec["evidence_id"]

            title_ev = ev("TITLE", title_key, title)
            buyer_rec = {"name": buyer, "identifier": None,
                         "evidence_id": ev("BUYER_NAME", buyer_key, buyer)}
            suppliers = []
            sup, sup_key = _rest2_field(item, "awardedSupplier", "supplierName",
                                         "awardedToSupplier")
            if sup:
                suppliers.append({"name": str(sup), "identifier_scheme": None,
                                   "identifier_id": None,
                                   "evidence_id": ev("SUPPLIER_NAME", sup_key, sup)})
            value_obj = {}
            amount, amount_key = _rest2_field(item, "awardedValue", "valueLow",
                                               "awardedAmount")
            if isinstance(amount, (int, float)):
                value_obj = {"amount": amount, "currency": "GBP",
                             "evidence_id": ev("VALUE_AMOUNT", amount_key, amount)}
            dates = {}
            for field, keys, out_key in (
                    ("PUBLISHED_DATE", ("publishedDate",), "published"),
                    ("AWARD_DATE", ("awardedDate", "awardDate"), "award"),
                    ("CONTRACT_START", ("start", "startDate", "contractStartDate"), "start"),
                    ("CONTRACT_END", ("end", "endDate", "contractEndDate"), "end")):
                val, key = _rest2_field(item, *keys)
                if val:
                    dates[out_key] = str(val)
                    ev(field, key, val)
            cpv = []
            codes = item.get("cpvCodes")
            if isinstance(codes, str):
                codes = [c.strip() for c in codes.split(",") if c.strip()]
            if isinstance(codes, list):
                for c in codes[:10]:
                    if isinstance(c, str) and c[:2].isdigit():
                        ev("CPV_CODE", "cpvCodes", c)
                        cpv.append({"code": c, "description": None})
            contracts.append({
                "record_id": record_id,
                "source": "CF",
                "ocid": None,
                "title": str(title),
                "title_evidence_id": title_ev,
                "description": None,
                "stage": "award" if suppliers else "unknown",
                "buyer": buyer_rec,
                "suppliers": suppliers,
                "value": value_obj,
                "dates": dates,
                "procedure_type": None,
                "cpv": cpv,
                "notice_url": f"https://www.contractsfinder.service.gov.uk/notice/{record_id}",
                "evidence": [e["evidence_id"] for e in evidence
                             if e["source_identifier"] == record_id],
                "raw_path": relpath,
                "fixture": fixture,
                "rest2_parsed": True,
            })
    return contracts, evidence
