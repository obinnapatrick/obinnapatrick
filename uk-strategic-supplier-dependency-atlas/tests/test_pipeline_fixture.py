"""End-to-end pipeline test on SYNTHETIC_TEST_FIXTURE data only.

Proves, without any network access:
1. official-list parsing -> supplier records with evidence
2. OCDS normalisation -> contracts with per-field evidence
3. entity resolution ladder -> conservative fact states
4. CH enrichment merge + ownership edges (org-level PSC)
5. indicators with formulas
6. truth-slice assembly with a complete, resolvable evidence ledger
7. schema + provenance validation (zero errors)
8. static profile rendering with fixture banner
9. fixture firewall: nothing leaks into outputs/ or data/processed/
10. deterministic rebuild (volatile timestamp fields excluded)

Run: python3 tests/test_pipeline_fixture.py
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src.procurement.truth_slice import build  # noqa: E402
from src.validation.gates import (check_fixture_firewall, check_prohibited_wording,
                                   validate_truth_slice)  # noqa: E402
from src.ui.render_profile import render  # noqa: E402

FIXTURE_RAW = os.path.join(ROOT, "tests", "fixtures", "raw")
FIXTURE_OUT = os.path.join(ROOT, "tests", "fixtures", "out")

VOLATILE_KEYS = {"built_at", "calculated_at", "assessed_at", "created_at",
                 "retrieved_at", "ran_at"}


def _strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: _strip_volatile(v) for k, v in obj.items()
                if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [_strip_volatile(v) for v in obj]
    return obj


def main() -> int:
    failures = []

    def check(cond, label):
        print(("PASS " if cond else "FAIL ") + label)
        if not cond:
            failures.append(label)

    if os.path.isdir(FIXTURE_OUT):
        shutil.rmtree(FIXTURE_OUT)

    doc = build("Fixturecorp Technology Services",
                raw_root=FIXTURE_RAW, out_root=FIXTURE_OUT)

    check(doc["meta"]["fixture_mode"] is True, "slice is flagged fixture_mode")
    check(doc["supplier"]["official_name"] == "Fixturecorp Technology Services",
          "supplier taken from captured (fixture) list")
    check(len(doc["contracts"]) == 4,
          f"4 fixture notices linked (got {len(doc['contracts'])})")

    states = {c["record_id"]: c["supplier_link"]["fact_state"]
              for c in doc["contracts"]}
    check(states.get("fixture-ocds-0001") == "CONFIRMED",
          "exact name + GB-COH + CH corroboration -> CONFIRMED")
    check(states.get("fixture-ocds-0002") == "CONFIRMED",
          "suffix variant + GB-COH + CH corroboration -> CONFIRMED")
    check(states.get("fixture-ocds-0003") == "POSSIBLE",
          "(UK) variant without identifier -> POSSIBLE")
    check(states.get("fixture-ocds-0005") == "PROBABLE",
          "exact name without identifier -> PROBABLE")
    check("fixture-ocds-0004" not in states, "unrelated supplier excluded")

    check(any(m["issue_type"] == "contract_attribution_ambiguous"
              for m in doc["manual_review_items"]),
          "POSSIBLE link raised a manual-review item")
    check(any(m["issue_type"] == "individual_psc_display_review"
              for m in doc["manual_review_items"]) is False,
          "corporate PSC did not raise personal-data review (org-level)")
    check(len(doc["ownership_edges"]) == 1
          and doc["ownership_edges"][0]["fact_state"] == "PROBABLE",
          "PSC produced one PROBABLE ownership edge")
    check(len(doc["companies_house_records"]) == 1,
          "CH record merged into slice")
    check(len(doc["public_bodies"]) == 2, "two buyer authorities aggregated")

    ind = {i["name"]: i for i in doc["indicators"]}
    check(ind["linked_contract_count"]["value"] == 3,
          "headline linked count = 3 (POSSIBLE excluded)")
    check(ind["possible_links_count"]["value"] == 1, "possible links = 1")
    check(ind["visible_contract_value_gbp"]["value"] == 2450000,
          "visible GBP value sums only valued headline notices")
    check(ind["direct_award_share"]["value"] == round(1 / 3, 4),
          "direct-award share = 1/3 headline notices with procedure type")
    check(all(i.get("formula") and i.get("limitations") and
              i.get("safe_to_display_reason") for i in doc["indicators"]),
          "every indicator carries formula + limitations + display reason")

    schema_errors, prov_errors = validate_truth_slice(doc)
    check(not schema_errors, f"schema validation clean ({schema_errors[:3]})")
    check(not prov_errors, f"provenance resolution clean ({prov_errors[:3]})")
    check(all(e["evidence_class"] == "SYNTHETIC_TEST_FIXTURE"
              and e["evidence_id"].startswith("FIXTURE-")
              for e in doc["evidence_ledger"]),
          "all fixture evidence labelled SYNTHETIC_TEST_FIXTURE / FIXTURE- prefix")

    html_path = render(doc, os.path.join(FIXTURE_OUT, "rendered",
                                          "fixture_profile.html"),
                       release_state="FIXTURE_TEST")
    html = open(html_path, encoding="utf-8").read()
    check("SYNTHETIC TEST FIXTURE" in html, "rendered page carries fixture banner")
    check("FIXTURE-" in html, "rendered page shows evidence IDs")
    check(html.count('class="fact') > 10, "fact-state labels rendered")

    # firewall: nothing may have leaked into real output trees
    check(check_fixture_firewall() == [],
          "fixture firewall: outputs/ and data/processed/ clean")
    check(check_prohibited_wording() == [],
          "publication-safety wording scan clean")

    # deterministic rebuild
    doc2 = build("Fixturecorp Technology Services",
                 raw_root=FIXTURE_RAW, out_root=FIXTURE_OUT)
    check(_strip_volatile(copy.deepcopy(doc)) == _strip_volatile(copy.deepcopy(doc2)),
          "rebuild from raw is deterministic (volatile timestamps excluded)")

    print(f"\n{len(failures)} failure(s)")
    if failures:
        for f in failures:
            print(" -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
