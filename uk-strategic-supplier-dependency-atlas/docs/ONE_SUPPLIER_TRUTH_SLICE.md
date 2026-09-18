# One-supplier truth slice

## Status: NOT BUILT (blocked at source access) — machinery ready

No supplier has been selected and no real slice exists, because the
official strategic-supplier list cannot be captured in this session
(mission rule: never select a supplier before the official source is
saved; never build from memory).

## What the slice will be

One official strategic supplier, end to end:

official-list row (evidence) → legal-entity candidates (from OCDS
`GB-COH` identifiers + CH search) → Companies House profile/previous
names/PSC (minimised) → ≥3 linked contract notices (FTS + CF, deduped by
ocid) → buyer authorities → CPV service categories → values/dates →
ownership/control edges (PROBABLE at best from PSC) → 9 neutral
indicators → confidence states on every link → manual-review queue →
evidence ledger → static HTML profile with evidence panels.

## Definition of done

The 27 conditions in mission section 21, enforced by:
`data/validation/acceptance_gates.json` (GATE-SRC/LOCK/SECRET/FIX/SAFE/
LIC/SCHEMA/PROV/SLICE) + docs/VALIDATION.md machinery checks + the
operator review gate.

## Exact command sequence (once access exists)

```bash
python3 scripts/atlas.py probe_sources                      # expect PASS/PARTIAL
python3 scripts/atlas.py fetch_suppliers                    # capture official list
python3 scripts/atlas.py score_suppliers --online           # visibility probing
# pick top evidence-clean non-trivial supplier; record reason in docs/DECISIONS.md
python3 scripts/atlas.py fetch_procurement --keyword "<SUPPLIER NAME>"
python3 scripts/atlas.py fetch_procurement --window 2026-01-01T00:00:00 2026-07-17T00:00:00
python3 scripts/atlas.py fetch_companies_house --number <GB-COH id from awards>
python3 scripts/atlas.py lock_sources
python3 scripts/atlas.py build_truth_slice --supplier "<SUPPLIER NAME>"
python3 scripts/atlas.py run_acceptance_gates
python3 scripts/atlas.py render_static_profile --supplier "<SUPPLIER NAME>"
```

The fixture twin of this flow already runs clean:
`python3 tests/test_pipeline_fixture.py` (27/27).
