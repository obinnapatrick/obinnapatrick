# Source-lock manifest

The source lock guarantees every displayed fact can be rebuilt from saved,
hashed raw evidence — no live-only queries.

## Mechanism

1. Every network fetch made by an adapter is written to `data/raw/...`
   with a `.meta.json` sidecar containing: source URL, query parameters,
   retrieval method, retrieval timestamp, HTTP status, sha256, byte size.
2. `python3 scripts/atlas.py lock_sources` sweeps `data/raw/` and appends
   one manifest entry per raw file to
   `data/processed/source_lock.jsonl` (schema:
   `schemas/source_lock.schema.json`), recording: source name, retrieval
   method, retrieval timestamp, source URL/endpoint, query parameters,
   local raw path, sha256, record count (where parseable), licence note,
   citation method, known limitations, refresh policy, and
   **evidence_class**.
3. Build steps (`build_truth_slice`, `render_static_profile`) are
   offline: they read only `data/raw/` + the manifest. Deleting
   `data/processed/` and rebuilding must reproduce identical outputs.

## Evidence classes

| Class | Meaning | May support displayed facts? |
|---|---|---|
| `EVIDENCE` | Byte-exact raw capture from the official source | Yes |
| `ACCESS_TEST` | Probe/failure record proving an access attempt | No (access reporting only) |
| `LOCATOR_ONLY` | Search-derived URL locator (snippets) | No |
| `MODEL_MEDIATED_FETCH` | Content obtained via a model-mediated fetch tool | No public display; private analysis at most, capped below CONFIRMED |
| `SYNTHETIC_TEST_FIXTURE` | Test fixture under `tests/fixtures/` | Never |

## Current state (2026-07-17)

**Evidence-grade captures: 0.** All official hosts are egress-blocked in
this session (see `docs/SOURCE_ACCESS_LOG.md`).

Locked artifacts so far (all non-evidence classes):

| Raw file | Class | Content |
|---|---|---|
| `data/raw/source_probe/probe_report.json` | ACCESS_TEST | Probe run results, verdict BLOCKED |
| `data/raw/source_probe/*.txt` + `.meta.json` | ACCESS_TEST | Per-host failure records (empty bodies, error + timestamp in meta) |
| `data/raw/source_probe/websearch_locator_govuk_publication.json` | LOCATOR_ONLY | Canonical publication URL locator |
| `data/raw/source_probe/webfetch_policy_test.json` | ACCESS_TEST | WebFetch/WebSearch policy test record |

Machine manifest: `data/processed/source_lock.jsonl` (regenerate with
`python3 scripts/atlas.py lock_sources`).

## Refresh policy (once unblocked)

- GOV.UK strategic supplier list: re-capture on each run; the list changes
  infrequently; keep every dated capture.
- FTS/CF notices: captures are immutable snapshots; re-harvest by date
  window; never overwrite a previously locked raw file (new timestamped
  filenames).
- Companies House: profile/PSC captures dated; refresh per truth-slice
  rebuild; respect 600 req/5 min.
