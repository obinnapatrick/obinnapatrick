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
