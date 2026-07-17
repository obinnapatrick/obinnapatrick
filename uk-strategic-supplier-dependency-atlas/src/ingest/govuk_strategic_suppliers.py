"""Adapter 1: GOV.UK official strategic supplier list.

fetch(): GET the publication via the GOV.UK content API, save raw, then
download list attachments (CSV/ODS) and save raw.
parse_offline(): parse the newest saved capture into normalised
StrategicSupplier records + evidence, without any network access.

The official publication slug (located via WebSearch locator record,
LOCATOR_ONLY): crown-representatives-and-strategic-suppliers
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import zipfile
from xml.etree import ElementTree

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.normalize.ocds import make_evidence  # noqa: E402

SLUG = "crown-representatives-and-strategic-suppliers"
CONTENT_API = f"https://www.gov.uk/api/content/government/publications/{SLUG}"
PUBLIC_URL = f"https://www.gov.uk/government/publications/{SLUG}"
RAW_SUBDIR = "strategic_suppliers"


class SourceAccessFailure(Exception):
    def __init__(self, kind: str, detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


def fetch() -> list[dict]:
    """Online capture. Returns saved-raw meta records. Raises on failure."""
    date = util.today_compact()
    r = util.http_fetch(CONTENT_API)
    if r.get("status") != 200:
        util.ledger("govuk_fetch_failed", str(r.get("error") or r.get("status")))
        raise SourceAccessFailure("http", f"{CONTENT_API} -> {r.get('status')} {r.get('error')}")
    saved = [util.save_raw(
        os.path.join(RAW_SUBDIR, f"govuk_content_{date}.json"), r["body"],
        {"source_name": "GOV.UK content API", "source_url": CONTENT_API,
         "retrieval_method": "HTTP GET", "http_status": 200,
         "public_page": PUBLIC_URL})]
    doc = json.loads(r["body"])
    attachments = ((doc.get("details") or {}).get("attachments")) or []
    for att in attachments:
        att_url = att.get("url") or ""
        if not att_url:
            continue
        if not re.search(r"\.(csv|ods|xlsx)$", att_url, re.I):
            continue
        time.sleep(util.DEFAULT_DELAY)
        ar = util.http_fetch(att_url)
        if ar.get("status") != 200:
            util.ledger("govuk_attachment_failed", f"{att_url} -> {ar.get('status')}")
            continue
        fname = os.path.basename(att_url.split("?")[0])
        saved.append(util.save_raw(
            os.path.join(RAW_SUBDIR, f"attachment_{date}_{fname}"), ar["body"],
            {"source_name": "GOV.UK publication attachment", "source_url": att_url,
             "retrieval_method": "HTTP GET", "http_status": 200,
             "attachment_title": att.get("title"), "public_page": PUBLIC_URL}))
    util.ledger("govuk_fetch", f"saved {len(saved)} raw files")
    return saved


# ---------------------------------------------------------------------------
# Offline parsing
# ---------------------------------------------------------------------------

_NAME_HEADER_HINTS = ("strategic supplier", "supplier", "company", "organisation", "name")


def _rows_from_csv(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig", errors="replace")
    return [row for row in csv.reader(io.StringIO(text)) if any(c.strip() for c in row)]


def _rows_from_ods(data: bytes) -> list[list[str]]:
    ns = {"table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
          "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ElementTree.fromstring(z.read("content.xml"))
    rows = []
    for row in root.iter(f"{{{ns['table']}}}table-row"):
        cells = []
        for cell in row.findall(f"{{{ns['table']}}}table-cell"):
            repeat = int(cell.get(f"{{{ns['table']}}}number-columns-repeated", "1"))
            txt = " ".join("".join(p.itertext()) for p in cell.findall(f"{{{ns['text']}}}p"))
            cells.extend([txt.strip()] * min(repeat, 50))
        if any(cells):
            rows.append(cells)
    return rows


def _supplier_rows(rows: list[list[str]]) -> tuple[int | None, int | None]:
    """Return (header_row_index, name_column_index) or (None, first_col)."""
    for i, row in enumerate(rows[:10]):
        for j, cell in enumerate(row):
            low = (cell or "").strip().lower()
            if any(h in low for h in _NAME_HEADER_HINTS) and len(low) < 60:
                return i, j
    return None, 0


def _newest(pattern: str, raw_root: str) -> str | None:
    d = os.path.join(raw_root, RAW_SUBDIR)
    if not os.path.isdir(d):
        return None
    matches = sorted(f for f in os.listdir(d)
                     if re.match(pattern, f) and not f.endswith(".meta.json"))
    return os.path.join(d, matches[-1]) if matches else None


def parse_offline(raw_root: str | None = None) -> tuple[list[dict], list[dict]]:
    """Parse newest saved capture -> (suppliers, evidence). Offline only."""
    raw_root = raw_root or util.RAW_DIR
    att = _newest(r"attachment_\d{8}_.*\.(csv|ods)$", raw_root)
    content = _newest(r"govuk_content_\d{8}\.json$", raw_root)
    if not att and not content:
        raise SourceAccessFailure(
            "no_raw_capture",
            "No saved GOV.UK strategic-supplier capture exists under "
            f"{raw_root}/{RAW_SUBDIR}. Run 'atlas.py fetch_suppliers' once "
            "network access to www.gov.uk is available.")

    meta = util.read_json((att or content) + ".meta.json", default={}) or {}
    fixture = bool(meta.get("SYNTHETIC_TEST_FIXTURE"))
    retrieved_at = meta.get("saved_at") or util.utcnow()
    date_compact = retrieved_at[:10].replace("-", "")
    source_url = meta.get("source_url") or PUBLIC_URL

    if att and att.endswith(".csv"):
        rows = _rows_from_csv(open(att, "rb").read())
    elif att and att.endswith(".ods"):
        rows = _rows_from_ods(open(att, "rb").read())
    else:
        raise SourceAccessFailure(
            "unparsed_format",
            "Only a content-API JSON exists; list attachment missing or in an "
            "unhandled format. Extend parser after inspecting the live "
            "attachment; do NOT hand-enter suppliers from memory.")

    header_i, name_j = _supplier_rows(rows)
    start = (header_i + 1) if header_i is not None else 0
    crown_j = None
    if header_i is not None:
        for j, cell in enumerate(rows[header_i]):
            if "crown representative" in (cell or "").lower():
                crown_j = j

    raw_relpath = os.path.relpath(att, util.ROOT)
    suppliers, evidence = [], []
    for n, row in enumerate(rows[start:], start=1):
        name = (row[name_j] if name_j < len(row) else "").strip()
        if not name or len(name) < 2:
            continue
        record_id = f"STRATEGIC_SUPPLIER_LIST_ROW{n:02d}"
        rec = make_evidence(
            fixture=fixture, source="GOVUK", date_compact=date_compact,
            record_id=record_id, field="SUPPLIER_NAME", source_url=source_url,
            raw_path=raw_relpath, json_pointer=f"row {start + n} col {name_j + 1}",
            value=name, retrieved_at=retrieved_at)
        evidence.append(rec)
        supplier = {
            "supplier_id": "SUP-" + util.normalise_name_core(name).replace(" ", "-")[:40],
            "official_name": name,
            "source_list": {"source_url": source_url,
                            "content_id": meta.get("content_id"),
                            "raw_path": raw_relpath,
                            "list_date": meta.get("public_updated_at")},
            "row_ordinal": n,
            "crown_representative": (row[crown_j].strip() if crown_j is not None
                                     and crown_j < len(row) and row[crown_j].strip()
                                     else None),
            "evidence": [rec["evidence_id"]],
            "fact_state": "CONFIRMED" if not fixture else "CONFIRMED",
            "notes": "SYNTHETIC_TEST_FIXTURE" if fixture else "",
        }
        if supplier["crown_representative"]:
            crec = make_evidence(
                fixture=fixture, source="GOVUK", date_compact=date_compact,
                record_id=record_id, field="CROWN_REPRESENTATIVE",
                source_url=source_url, raw_path=raw_relpath,
                json_pointer=f"row {start + n} col {crown_j + 1}",
                value=supplier["crown_representative"], retrieved_at=retrieved_at)
            evidence.append(crec)
            supplier["evidence"].append(crec["evidence_id"])
        suppliers.append(supplier)

    if not suppliers:
        raise SourceAccessFailure("zero_rows", f"Parsed no supplier rows from {att}")
    return suppliers, evidence


if __name__ == "__main__":
    if "--offline" in sys.argv:
        sups, ev = parse_offline()
        print(json.dumps({"suppliers": len(sups), "evidence": len(ev)}, indent=2))
    else:
        fetch()
