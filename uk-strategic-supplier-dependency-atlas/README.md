# UK Strategic Supplier Dependency Atlas — Public Alpha (in build)

An evidence-linked data system showing how official UK government
strategic suppliers connect to legal entities, Companies House records,
public contract notices, buyer authorities, service categories, contract
values/dates, publicly verifiable ownership/control evidence, and neutral
dependency indicators — with source evidence, deterministic evidence IDs,
confidence labels, and explicit unresolved states on every claim.

**Current state: BLOCKED / NEEDS HUMAN DECISION — artifact level:
METHODOLOGY AND DATA-SPINE PACKAGE.** This build session's execution
environment denies network access to every required official source
(evidence: `data/raw/source_probe/probe_report.json`), so the repository
contains complete, tested machinery and **zero real data**. Nothing here
asserts anything about any real organisation. See
`docs/PROJECT_STATE.md` and `docs/RELEASE_STATE.md`.

## What the atlas is not

Not a tender-alert product, bid tool, CRM, generic dashboard, accusation
engine, or speculative risk scorer. It shows structure and evidence in
neutral language only (`docs/PUBLICATION_SAFETY.md`).

## Quick start

```bash
# offline health check (synthetic fixtures; no network):
python3 tests/test_pipeline_fixture.py          # expect 27/27 PASS
python3 scripts/atlas.py run_acceptance_gates   # expect 5 pass / 0 fail / 5 blocked

# with network access to the official sources (see docs/SOURCE_ACCESS_LOG.md):
python3 scripts/atlas.py probe_sources
# then follow docs/NEXT_COMMANDS.md
```

Requirements: Python 3.11+ (stdlib only). Optional:
`COMPANIES_HOUSE_API_KEY` (see `.env.example`).

## Commands (`python3 scripts/atlas.py <command>`)

| Command | Purpose |
|---|---|
| `setup_project` | verify directory tree |
| `probe_sources` | prove live access; PASS/PARTIAL/BLOCKED verdict |
| `fetch_suppliers` | capture the official GOV.UK strategic supplier list |
| `fetch_procurement` | capture FTS/CF data (`--keyword` / `--window`) |
| `fetch_companies_house` | capture CH profile+PSC (`--number`; needs key) |
| `lock_sources` | hash + register every raw capture |
| `review_licences` / `check_secrets` | firewall status commands |
| `build_source_adapters` | machine-readable adapter contracts |
| `score_suppliers` | supplier-selection table (10 criteria) |
| `build_truth_slice` | assemble one-supplier evidence graph (offline) |
| `run_acceptance_gates` | machine-readable gates |
| `render_static_profile` | static HTML profile with evidence panels |
| `expand_mini_cohort` / `validate_alpha` / `render_static_alpha` / `generate_findings` | gated later phases |
| `run_public_claim_firewall` | finding-level safety review |
| `prepare_operator_review` / `decide_release_state` / `package_release` / `write_handoff` | release workflow |

All commands log to `docs/RUN_LEDGER.md` and update
`data/validation/status.json`; none delete raw evidence.

## Layout

- `docs/` — state, methodology, sources, firewalls, checkpoints, handoff
- `schemas/` — 17 JSON Schemas (graph entities, evidence, gates, …)
- `src/` — adapters, normaliser, resolution, indicators, ownership,
  slice builder, gates, renderer
- `data/raw` (immutable captures + meta) / `data/processed` (rebuildable)
  / `data/validation` / `data/manual_review`
- `outputs/` — real profiles/findings only (fixture-firewalled; currently
  empty by design)
- `tests/fixtures` — synthetic, loudly-labelled test data + 27-check e2e test

## Evidence model in one paragraph

Every fetch is saved raw with URL, params, timestamp and sha256, then
registered in the source-lock manifest. Builders run offline from raw
only. Every extracted field gets a deterministic evidence ID
(`SRC-{source}-{date}-{record}-{field}`) resolving to raw file + JSON
pointer + value + transformation + provenance class + fact state. Gates
refuse any displayed claim whose evidence does not resolve. Search
snippets, model-mediated fetches and fixtures are structurally barred
from supporting facts.

## Licence and attribution

Data sources are expected to be OGL v3.0 / Companies House terms —
classification is **provisional** until verified from live terms
(`docs/LICENCE_AND_TERMS_REVIEW.md`); nothing may be published before
that verification and the operator review gate.
