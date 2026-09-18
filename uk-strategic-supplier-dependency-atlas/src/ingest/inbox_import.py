"""File-drop fallback importer (data/inbox/ -> data/raw/).

Lawful fallback when live fetching is impossible: the operator downloads
official files in a browser and drops them in data/inbox/ together with a
metadata sidecar `<filename>.source.json`:

    {
      "source_url": "https://www.gov.uk/...",        (required, official domain)
      "retrieved_at": "2026-07-17T10:00:00Z",        (required, ISO timestamp)
      "retrieval_method": "manual browser download"  (required)
    }

Rules (mission section 5): identify the source type by content; preserve
the original file (copy, never move); hash and lock the imported copy;
record operator-supplied retrieval metadata; refuse unsupported or
ambiguous files; never treat an unverified file as confirmed evidence -
every import opens a manual-review item covering the provenance
attestation, and files without a valid sidecar or from non-official
domains are refused outright.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import sys
import urllib.parse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402
from src.companies_house.adapter import _minimise  # noqa: E402

OFFICIAL_DOMAINS = (
    "www.gov.uk", "assets.publishing.service.gov.uk",
    "www.find-tender.service.gov.uk", "www.contractsfinder.service.gov.uk",
    "api.company-information.service.gov.uk",
    "find-and-update.company-information.service.gov.uk",
    "download.companieshouse.gov.uk",
)

REQUIRED_SIDECAR_KEYS = ("source_url", "retrieved_at", "retrieval_method")


def _detect_type(path: str) -> tuple[str | None, str]:
    """Return (raw_subdir, type_label) or (None, refusal reason)."""
    name = os.path.basename(path).lower()
    try:
        head = open(path, "rb").read(400_000)
    except Exception as e:
        return None, f"unreadable: {e}"
    if name.endswith((".csv", ".ods")):
        if name.endswith(".csv"):
            try:
                text = head.decode("utf-8-sig", errors="replace")
                first = next(csv.reader(io.StringIO(text)), [])
            except Exception:
                first = []
            if any("supplier" in (c or "").lower() or "organisation" in (c or "").lower()
                   for c in first):
                return "strategic_suppliers", "supplier_list_csv"
            return None, "CSV present but header does not identify a supplier list"
        return "strategic_suppliers", "supplier_list_ods"
    if name.endswith(".json"):
        try:
            doc = json.loads(head if len(head) < 400_000 else open(path, "rb").read())
        except Exception:
            return None, "invalid JSON"
        if isinstance(doc, dict):
            if isinstance(doc.get("releases"), list):
                return "procurement", "ocds_release_package"
            if doc.get("company_number") and doc.get("company_name"):
                return "companies_house", "ch_company_profile"
            if isinstance(doc.get("items"), list) and any(
                    isinstance(i, dict) and i.get("natures_of_control") is not None
                    for i in doc["items"]):
                return "companies_house", "ch_psc"
            if (doc.get("details") or {}).get("attachments") is not None \
                    or doc.get("base_path"):
                return "strategic_suppliers", "govuk_content_api"
            for key in ("noticeList", "results", "notices"):
                if isinstance(doc.get(key), list):
                    return "procurement", "cf_rest2_search"
        return None, "JSON structure not recognised as a supported official payload"
    return None, f"unsupported file type: {name}"


def _validate_sidecar(sidecar_path: str) -> tuple[dict | None, str]:
    if not os.path.exists(sidecar_path):
        return None, ("missing sidecar - create "
                      f"{os.path.basename(sidecar_path)} with keys "
                      f"{list(REQUIRED_SIDECAR_KEYS)} (see data/inbox/README.md)")
    try:
        sc = json.load(open(sidecar_path, encoding="utf-8"))
    except Exception as e:
        return None, f"sidecar is not valid JSON: {e}"
    missing = [k for k in REQUIRED_SIDECAR_KEYS if not sc.get(k)]
    if missing:
        return None, f"sidecar missing required keys: {missing}"
    host = urllib.parse.urlparse(str(sc["source_url"])).hostname or ""
    if host not in OFFICIAL_DOMAINS:
        return None, (f"source_url host '{host}' is not an allowlisted official "
                      f"domain {list(OFFICIAL_DOMAINS)}")
    if not re.match(r"^\d{4}-\d{2}-\d{2}", str(sc["retrieved_at"])):
        return None, "retrieved_at must be an ISO date/timestamp"
    return sc, ""


def import_all(inbox_dir: str | None = None, raw_root: str | None = None,
               dry_run: bool = False) -> dict:
    inbox_dir = inbox_dir or os.environ.get("ATLAS_INBOX_DIR") \
        or os.path.join(util.ROOT, "data", "inbox")
    raw_root = raw_root or os.environ.get("ATLAS_IMPORT_RAW_ROOT") or util.RAW_DIR
    imported, refused = [], []
    if not os.path.isdir(inbox_dir):
        return {"imported": imported, "refused": refused,
                "note": f"no inbox directory at {inbox_dir}"}
    for fname in sorted(os.listdir(inbox_dir)):
        if fname.lower() in ("readme.md",) or fname.endswith(".source.json"):
            continue
        path = os.path.join(inbox_dir, fname)
        if not os.path.isfile(path):
            continue
        sidecar, err = _validate_sidecar(path + ".source.json")
        if not sidecar:
            refused.append({"file": fname, "reason": err})
            continue
        subdir, type_label = _detect_type(path)
        if not subdir:
            refused.append({"file": fname, "reason": type_label})
            continue
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", fname)
        dest_rel = os.path.join(subdir, f"inbox_{util.today_compact()}_{safe}")
        dest = os.path.join(raw_root, dest_rel)
        if dry_run:
            imported.append({"file": fname, "type": type_label,
                             "would_write": dest_rel, "dry_run": True})
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if type_label in ("ch_company_profile", "ch_psc"):
            # data minimisation applies to manual imports too
            doc = json.load(open(path, encoding="utf-8"))
            redactions: list[str] = []
            doc = _minimise(doc, redactions)
            body = json.dumps(doc, indent=2, ensure_ascii=False).encode()
        else:
            body = open(path, "rb").read()
            redactions = []
        with open(dest, "wb") as f:
            f.write(body)
        meta = {
            "source_name": f"manual file-drop import ({type_label})",
            "source_url": sidecar["source_url"],
            "retrieval_method": f"manual file drop: {sidecar['retrieval_method']}",
            "saved_at": util.utcnow(),
            "operator_retrieved_at": sidecar["retrieved_at"],
            "manual_import": True,
            "import_verification": "pending_manual_review",
            "imported_from": os.path.join("data", "inbox", fname),
            "data_minimisation_redactions": redactions,
            "sha256": util.sha256_bytes(body),
            "bytes": len(body),
            "local_path": os.path.relpath(dest, util.ROOT)
                if raw_root == util.RAW_DIR else dest_rel,
            "evidence_class": "EVIDENCE",
        }
        with open(dest + ".meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
        if raw_root == util.RAW_DIR:
            util.append_jsonl(os.path.join(util.MANUAL_REVIEW_DIR, "queue.jsonl"), {
                "item_id": f"MR-INBOX-{util.today_compact()}-{safe[:40]}",
                "entity_affected": meta["local_path"],
                "issue_type": "manual_import_provenance_attestation",
                "evidence_available": [],
                "candidate_resolutions": [
                    "Re-capture the same record via live fetch and compare hashes",
                    "Confirm the operator-supplied source_url serves this content"],
                "recommended_next_step": "Verify provenance before relying on this "
                                          "capture for any public display",
                "publication_status": "private_only",
                "severity": "medium",
                "created_at": util.utcnow(),
                "resolved_at": None,
                "resolution": None,
            })
            util.ledger("import_inbox", f"{fname} -> {meta['local_path']} ({type_label})")
        imported.append({"file": fname, "type": type_label,
                         "raw_path": meta["local_path"]})
    return {"imported": imported, "refused": refused}


if __name__ == "__main__":
    print(json.dumps(import_all(dry_run="--dry-run" in sys.argv), indent=2))
