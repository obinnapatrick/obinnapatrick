"""Shared utilities for the UK Strategic Supplier Dependency Atlas.

Stdlib-only. Every network fetch is saved raw with a sidecar meta file so
that all downstream processing can run offline from saved evidence.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Project root = two levels above this file (src/util.py -> project root)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

RAW_DIR = os.path.join(ROOT, "data", "raw")
PROCESSED_DIR = os.path.join(ROOT, "data", "processed")
VALIDATION_DIR = os.path.join(ROOT, "data", "validation")
MANUAL_REVIEW_DIR = os.path.join(ROOT, "data", "manual_review")
DOCS_DIR = os.path.join(ROOT, "docs")
OUTPUTS_DIR = os.path.join(ROOT, "outputs")

USER_AGENT = (
    "uk-strategic-supplier-dependency-atlas/0.1 "
    "(research alpha; evidence-linked public-data atlas; contact: see repo)"
)

# Conservative politeness delay between requests to the same host (seconds).
DEFAULT_DELAY = 1.0


def utcnow() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def today_compact() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%d")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ssl_context() -> ssl.SSLContext:
    cafile = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if cafile and os.path.exists(cafile):
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def http_fetch(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    body: bytes | None = None,
    timeout: int = 60,
    retries: int = 2,
    retry_delay: float = 2.0,
) -> dict:
    """Fetch a URL. Returns dict with status, headers, body(bytes), error.

    Never raises on HTTP errors; the caller inspects `status`/`error` so
    that failed probes are themselves recordable evidence.
    """
    hdrs = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
                return {
                    "url": url,
                    "status": resp.status,
                    "headers": dict(resp.headers.items()),
                    "body": resp.read(),
                    "error": None,
                }
        except urllib.error.HTTPError as e:
            # HTTP-level error: a definitive answer, no retry for 4xx.
            data = b""
            try:
                data = e.read()
            except Exception:
                pass
            result = {
                "url": url,
                "status": e.code,
                "headers": dict(e.headers.items()) if e.headers else {},
                "body": data,
                "error": f"HTTPError {e.code}: {e.reason}",
            }
            if 400 <= e.code < 500:
                return result
            last_err = result
        except Exception as e:  # URLError, timeout, TLS, proxy
            last_err = {
                "url": url,
                "status": None,
                "headers": {},
                "body": b"",
                "error": f"{type(e).__name__}: {e}",
            }
        if attempt < retries:
            time.sleep(retry_delay * (2 ** attempt))
    return last_err


def save_raw(
    relpath: str,
    body: bytes,
    meta: dict,
) -> dict:
    """Save raw bytes under data/raw/<relpath> plus a .meta.json sidecar.

    Returns the meta record (including sha256 and paths) for the source lock.
    """
    path = os.path.join(RAW_DIR, relpath)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)
    digest = sha256_bytes(body)
    record = dict(meta)
    record.update(
        {
            "local_path": os.path.relpath(path, ROOT),
            "sha256": digest,
            "bytes": len(body),
            "saved_at": utcnow(),
        }
    )
    with open(path + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
    return record


def append_jsonl(path: str, record: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, sort_keys=False)


def read_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Evidence IDs
# ---------------------------------------------------------------------------

_ID_CLEAN = re.compile(r"[^A-Za-z0-9]+")


def _idpart(value: str, maxlen: int = 40) -> str:
    cleaned = _ID_CLEAN.sub("_", str(value)).strip("_").upper()
    return cleaned[:maxlen] if cleaned else "UNKNOWN"


def evidence_id(source: str, date_compact: str, record_id: str, field: str) -> str:
    """Deterministic evidence ID: SRC-{source}-{date}-{record_id}-{field}."""
    return "SRC-{}-{}-{}-{}".format(
        _idpart(source, 12), date_compact, _idpart(record_id, 48), _idpart(field, 40)
    )


# ---------------------------------------------------------------------------
# Run ledger / status
# ---------------------------------------------------------------------------

STATUS_PATH = os.path.join(VALIDATION_DIR, "status.json")
RUN_LEDGER_PATH = os.path.join(DOCS_DIR, "RUN_LEDGER.md")


def ledger(step: str, detail: str) -> None:
    """Append one line to the human-readable run ledger."""
    os.makedirs(DOCS_DIR, exist_ok=True)
    line = f"| {utcnow()} | {step} | {detail} |\n"
    if not os.path.exists(RUN_LEDGER_PATH):
        with open(RUN_LEDGER_PATH, "w", encoding="utf-8") as f:
            f.write(
                "# Run ledger\n\nAppend-only log of pipeline actions.\n\n"
                "| timestamp (UTC) | step | detail |\n|---|---|---|\n"
            )
    with open(RUN_LEDGER_PATH, "a", encoding="utf-8") as f:
        f.write(line)
    print(f"[ledger] {step}: {detail}", file=sys.stderr)


def update_status(**kwargs) -> dict:
    """Merge keys into data/validation/status.json (machine-readable state)."""
    status = read_json(STATUS_PATH, default={})
    status.update(kwargs)
    status["updated_at"] = utcnow()
    write_json(STATUS_PATH, status)
    return status


# ---------------------------------------------------------------------------
# Name normalisation (deterministic, documented in METHODOLOGY.md)
# ---------------------------------------------------------------------------

_CORP_SUFFIXES = [
    "limited", "ltd", "plc", "llp", "llc", "inc", "incorporated", "corp",
    "corporation", "gmbh", "sa", "s.a.", "bv", "b.v.", "uk", "(uk)",
    "holdings", "group", "co", "company", "services",
]


def normalise_name(name: str) -> str:
    """Lowercase, strip punctuation and common corporate suffixes.

    Used ONLY for candidate matching; the raw name is always preserved and
    every match records the method used.
    """
    s = (name or "").lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalise_name_core(name: str) -> str:
    """normalise_name plus trailing corporate-suffix stripping."""
    s = normalise_name(name)
    tokens = s.split(" ")
    while tokens and tokens[-1] in _CORP_SUFFIXES:
        tokens.pop()
    return " ".join(tokens) if tokens else s
