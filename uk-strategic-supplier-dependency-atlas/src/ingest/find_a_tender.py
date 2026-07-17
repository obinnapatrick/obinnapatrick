"""Adapter 2: Find a Tender OCDS release packages.

fetch_window(): harvest a date window (cursor paging) and save each page
raw. fetch_ocid(): targeted re-capture of one OCID. load_offline(): parse
all saved FTS packages into contract records + evidence (offline).

API parameter names follow the documented FTS OCDS API and must be
re-verified live (docs/SOURCE_ADAPTERS.md).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.normalize.ocds import normalise_release_package  # noqa: E402

BASE = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
RAW_SUBDIR = "procurement"
MAX_PAGES = 25


def fetch_window(updated_from: str, updated_to: str) -> list[dict]:
    date = util.today_compact()
    url = f"{BASE}?updatedFrom={updated_from}&updatedTo={updated_to}"
    saved, page = [], 0
    while url and page < MAX_PAGES:
        r = util.http_fetch(url)
        if r.get("status") != 200:
            util.ledger("fts_fetch_failed", f"page {page}: {r.get('status')} {r.get('error')}")
            if not saved:
                raise RuntimeError(f"FTS window fetch failed: {r.get('error') or r.get('status')}")
            break
        meta = {"source_name": "Find a Tender OCDS", "source_url": url,
                "retrieval_method": "HTTP GET", "http_status": 200,
                "window": [updated_from, updated_to], "page": page}
        saved.append(util.save_raw(
            os.path.join(RAW_SUBDIR, f"fts_packages_{date}_{page:03d}.json"),
            r["body"], meta))
        try:
            doc = json.loads(r["body"])
        except Exception:
            break
        url = ((doc.get("links") or {}).get("next"))
        page += 1
        time.sleep(util.DEFAULT_DELAY)
    util.ledger("fts_fetch_window", f"{updated_from}..{updated_to}: {len(saved)} pages")
    return saved


def fetch_ocid(ocid: str) -> dict:
    url = f"{BASE}/{ocid}"
    r = util.http_fetch(url)
    if r.get("status") != 200:
        raise RuntimeError(f"FTS ocid fetch failed: {ocid}: {r.get('error') or r.get('status')}")
    return util.save_raw(
        os.path.join(RAW_SUBDIR, f"fts_ocid_{util.today_compact()}_{re.sub(r'[^A-Za-z0-9]+', '_', ocid)}.json"),
        r["body"],
        {"source_name": "Find a Tender OCDS", "source_url": url,
         "retrieval_method": "HTTP GET", "http_status": 200, "ocid": ocid})


def load_offline(raw_root: str | None = None) -> tuple[list[dict], list[dict]]:
    raw_root = raw_root or util.RAW_DIR
    d = os.path.join(raw_root, RAW_SUBDIR)
    contracts, evidence = [], []
    if not os.path.isdir(d):
        return contracts, evidence
    for fname in sorted(os.listdir(d)):
        if not re.match(r"fts_.*\.json$", fname) or fname.endswith(".meta.json"):
            continue
        path = os.path.join(d, fname)
        meta = util.read_json(path + ".meta.json", default={}) or {}
        try:
            package = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            util.ledger("fts_parse_failed", f"{fname}: {e}")
            continue
        relpath = os.path.relpath(path, util.ROOT)
        c, e = normalise_release_package(package, source="FAT",
                                          raw_relpath=relpath, meta=meta)
        contracts.extend(c)
        evidence.extend(e)
    return contracts, evidence
