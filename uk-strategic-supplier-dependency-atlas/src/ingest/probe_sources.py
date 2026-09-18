"""Phase 0 source-spine probe.

Verifies live access to each required official source, saves the raw
response of every probe (success or failure) under data/raw/source_probe/,
and emits a machine-readable probe report with a PASS / PARTIAL / BLOCKED
verdict.

No probe result is ever presented as atlas evidence directly; probes only
establish access and preserve first raw samples.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

PROBE_DIR = "source_probe"


def _window_days(days: int = 2) -> tuple[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    frm = now - dt.timedelta(days=days)
    return frm.strftime("%Y-%m-%dT%H:%M:%S"), now.strftime("%Y-%m-%dT%H:%M:%S")


def _record(name: str, url: str, result: dict, note: str = "") -> dict:
    body = result.get("body") or b""
    ext = ".json"
    ctype = (result.get("headers") or {}).get("Content-Type", "")
    if "html" in ctype:
        ext = ".html"
    elif "json" not in ctype and not body.lstrip()[:1] in (b"{", b"["):
        ext = ".txt"
    relpath = os.path.join(PROBE_DIR, f"{name}{ext}")
    meta = {
        "probe": name,
        "source_url": url,
        "retrieval_method": "HTTP GET (stdlib urllib via session proxy)",
        "http_status": result.get("status"),
        "error": result.get("error"),
        "content_type": ctype,
        "note": note,
    }
    saved = util.save_raw(relpath, body, meta)
    ok = result.get("status") is not None and 200 <= result["status"] < 300
    return {
        "probe": name,
        "url": url,
        "http_status": result.get("status"),
        "ok": ok,
        "reachable": result.get("status") is not None,
        "error": result.get("error"),
        "bytes": len(body),
        "raw_file": saved["local_path"],
        "sha256": saved["sha256"],
        "note": note,
    }


def run() -> dict:
    results = []
    ch_key = os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()

    # 1. GOV.UK content API: official strategic suppliers publication.
    # Canonical slug located via WebSearch on 2026-07-17:
    # "Crown Representatives and strategic suppliers".
    url = ("https://www.gov.uk/api/content/government/publications/"
           "crown-representatives-and-strategic-suppliers")
    r = util.http_fetch(url)
    results.append(_record("govuk_strategic_suppliers_content", url, r,
                           "GOV.UK content API for the official strategic suppliers publication"))
    time.sleep(util.DEFAULT_DELAY)

    # 1b. GOV.UK attachment CDN (strategic supplier list attachments live here)
    url = "https://assets.publishing.service.gov.uk/robots.txt"
    r = util.http_fetch(url)
    results.append(_record("govuk_assets_cdn", url, r,
                           "GOV.UK attachment CDN reachability (robots.txt)"))
    time.sleep(util.DEFAULT_DELAY)

    # 2. Find a Tender OCDS release packages (small recent window)
    frm, to = _window_days(1)
    url = ("https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
           f"?updatedFrom={frm}&updatedTo={to}")
    r = util.http_fetch(url)
    results.append(_record("fts_ocds_release_packages", url, r,
                           "Find a Tender OCDS API, 1-day update window"))
    time.sleep(util.DEFAULT_DELAY)

    # 3. Contracts Finder OCDS harvester search (date window)
    url = ("https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"
           "?publishedFrom=2026-07-14&publishedTo=2026-07-16&limit=5")
    r = util.http_fetch(url)
    results.append(_record("contracts_finder_ocds_search", url, r,
                           "Contracts Finder OCDS search, date window"))
    time.sleep(util.DEFAULT_DELAY)

    # 4. Contracts Finder REST v2 keyword search (documented public API)
    url = ("https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json"
           "?keyword=cloud&size=3")
    r = util.http_fetch(url)
    results.append(_record("contracts_finder_rest2_keyword", url, r,
                           "Contracts Finder REST v2 keyword search"))
    time.sleep(util.DEFAULT_DELAY)

    # 5. Companies House REST API (company 00000006 is a stable early number)
    url = "https://api.company-information.service.gov.uk/company/00000006"
    headers = {}
    ch_note = "no COMPANIES_HOUSE_API_KEY in environment; probing unauthenticated"
    if ch_key:
        import base64
        headers["Authorization"] = "Basic " + base64.b64encode((ch_key + ":").encode()).decode()
        ch_note = "COMPANIES_HOUSE_API_KEY present; probing authenticated"
    r = util.http_fetch(url, headers=headers)
    results.append(_record("companies_house_api_company", url, r, ch_note))
    time.sleep(util.DEFAULT_DELAY)

    # 6. Companies House public web profile (citation-link resolvability only)
    url = "https://find-and-update.company-information.service.gov.uk/company/00000006"
    r = util.http_fetch(url)
    results.append(_record("companies_house_web_profile", url, r,
                           "Public CH web profile - used for LINK-ONLY citations, not scraping"))
    time.sleep(util.DEFAULT_DELAY)

    # 7. Companies House bulk data product (key-free lawful fallback for
    #    company profile data; large snapshot, probe reachability only)
    url = "https://download.companieshouse.gov.uk/en_output.html"
    r = util.http_fetch(url)
    results.append(_record("companies_house_bulk_download", url, r,
                           "Free Company Data Product index page (key-free bulk fallback)"))

    ok_names = {x["probe"] for x in results if x["ok"]}
    core_ok = {"govuk_strategic_suppliers_content"} <= ok_names and (
        "fts_ocds_release_packages" in ok_names
        or "contracts_finder_ocds_search" in ok_names
        or "contracts_finder_rest2_keyword" in ok_names
    )
    ch_ok = "companies_house_api_company" in ok_names
    if core_ok and ch_ok:
        verdict = "PASS"
    elif core_ok:
        verdict = "PARTIAL"
    else:
        verdict = "BLOCKED"

    report = {
        "ran_at": util.utcnow(),
        "verdict": verdict,
        "companies_house_key_present": bool(ch_key),
        "probes": results,
    }
    util.write_json(os.path.join(util.RAW_DIR, PROBE_DIR, "probe_report.json"), report)
    util.ledger("probe_sources", f"verdict={verdict}; ok={sorted(ok_names)}")
    util.update_status(source_probe_verdict=verdict,
                       source_probe_at=report["ran_at"],
                       companies_house_key_present=bool(ch_key))
    print(json.dumps(report, indent=2)[:4000])
    return report


if __name__ == "__main__":
    run()
