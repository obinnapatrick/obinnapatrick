"""Checkpoint writer: docs/CHECKPOINTS.md + data/validation/checkpoints.json."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

CHECKPOINTS_JSON = os.path.join(util.VALIDATION_DIR, "checkpoints.json")
CHECKPOINTS_MD = os.path.join(util.DOCS_DIR, "CHECKPOINTS.md")

TITLES = {
    "CP0": "Repository created",
    "CP1": "Source spine verified",
    "CP2": "Source-lock manifest created",
    "CP3": "Source adapters specified",
    "CP4": "Supplier shortlist scored",
    "CP5": "Graph schema created",
    "CP6": "One-supplier truth slice built",
    "CP7": "Acceptance gates passed",
    "CP8": "Static supplier profile rendered",
    "CP9": "Mini cohort processed",
    "CP10": "Validation completed",
    "CP11": "Findings generated",
    "CP12": "Release state decided",
}


def write_checkpoint(cp_id: str, phase: str, completed: list[str],
                     missing: list[str], status: str, next_command: str,
                     note: str, blocker: str | None = None,
                     files_changed: list[str] | None = None,
                     evidence_saved: list[str] | None = None) -> dict:
    rec = {
        "checkpoint_id": cp_id,
        "title": TITLES.get(cp_id, cp_id),
        "phase": phase,
        "timestamp": util.utcnow(),
        "completed_outputs": completed,
        "missing_outputs": missing,
        "files_changed": files_changed or [],
        "evidence_saved": evidence_saved or [],
        "status": status,
        "blocker": blocker,
        "next_command": next_command,
        "continuation_note": note,
    }
    doc = util.read_json(CHECKPOINTS_JSON, default={}) or {}
    doc[cp_id] = rec
    util.write_json(CHECKPOINTS_JSON, doc)

    lines = ["# Checkpoints\n",
             "Machine-readable twin: `data/validation/checkpoints.json`.\n"]
    for key in sorted(doc, key=lambda k: int(k[2:])):
        r = doc[key]
        lines.append(f"\n## {key} — {r.get('title', key)} [{r['status'].upper()}]\n")
        lines.append(f"- phase: {r['phase']}  \n- at: {r['timestamp']}\n")
        if r.get("completed_outputs"):
            lines.append("- completed: " + "; ".join(r["completed_outputs"]) + "\n")
        if r.get("missing_outputs"):
            lines.append("- missing: " + "; ".join(r["missing_outputs"]) + "\n")
        if r.get("blocker"):
            lines.append(f"- blocker: {r['blocker']}\n")
        lines.append(f"- next command: `{r['next_command']}`\n")
        lines.append(f"- continuation: {r['continuation_note']}\n")
    with open(CHECKPOINTS_MD, "w", encoding="utf-8") as f:
        f.writelines(lines)
    util.ledger("checkpoint", f"{cp_id} {status}")
    return rec
