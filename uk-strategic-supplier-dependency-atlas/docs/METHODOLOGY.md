# Methodology

## What the atlas asserts

Chains of the form: official strategic supplier → legal entity →
Companies House record → public contract notices → buyer authority →
service/category → values/dates → ownership/control evidence →
neutral dependency indicators — every link carrying source evidence, an
evidence ID, and a fact state.

## Pipeline stages (all commands in `scripts/atlas.py`)

1. **probe_sources** — verify live access; save probe evidence; verdict
   PASS/PARTIAL/BLOCKED.
2. **fetch stages (online)** — adapters capture raw payloads to
   `data/raw/**` with `.meta.json` sidecars (URL, params, timestamp,
   sha256). *The only stages that touch the network.*
3. **lock_sources** — sweep raw files into
   `data/processed/source_lock.jsonl` (schema `source_lock.schema.json`).
4. **build stages (offline)** — parse raw → normalised records
   (`strategic_suppliers.jsonl`, `contracts.jsonl`,
   `companies_house.jsonl`), resolve entities, compute indicators,
   assemble the supplier truth slice (`truth_slice_{supplier}.json`) and
   the evidence ledger (`evidence_ledger.jsonl`).
5. **run_acceptance_gates** — machine-readable gates to
   `data/validation/acceptance_gates.json`.
6. **render_static_profile** — static HTML from processed JSON only; no
   live queries; every displayed claim shows its evidence ID and links.

Deleting `data/processed/` and re-running steps 3–6 must reproduce
identical outputs from `data/raw/` alone — this is the reproducibility
gate.

## Evidence IDs

`SRC-{source}-{yyyymmdd}-{record_id}-{field}` — deterministic; resolves
via the evidence ledger to raw file + JSON pointer + extracted value +
transformation + fact state. Fixture evidence uses the `FIXTURE-` prefix
and is firewalled from real outputs.

## Provenance classes

- `DIRECT_OBSERVATION` — the source says this, verbatim.
- `DETERMINISTIC_TRANSFORMATION` — documented normalisation/calculation.
- `MODEL_ASSISTED_CANDIDATE` — a model proposed it; never confirmable by
  itself; always paired with an audit-trail record.
- `HUMAN_REVIEWED_CONCLUSION` — recorded manual review.

## Entity resolution ladder (deterministic first)

1. exact company number (`GB-COH` identifier in procurement data, or CH)
2. exact legal name
3. normalised legal name (documented normaliser in `src/util.py`)
4. previous company name (CH)
5. registered office/postcode
6. FTS organisation identifier
7. Companies House search result
8. deterministic alias rule (recorded per rule)
9. model-assisted candidate ranking (audit trail required)
10. manual review

Fact-state policy: methods 1–2 with corroboration → up to CONFIRMED;
3–7 → PROBABLE/POSSIBLE depending on corroboration; 8 → per rule record;
9 → POSSIBLE at most; unresolved/conflicting states preserved, never
forced. Every match records method, score, alternatives, evidence for and
against, reason, reviewer status, date.

## Name normalisation (deterministic)

Lowercase → strip punctuation → collapse whitespace → (core variant)
strip trailing corporate suffixes (ltd/limited/plc/llp/holdings/group/uk…).
Raw names are always preserved; normalisation is recorded as a
`DETERMINISTIC_TRANSFORMATION`.

## Indicators (neutral only)

Each indicator record carries formula, input fields, input record IDs,
evidence IDs, limitations, confidence, calculation date, and a
safe-to-display reason. Initial set: linked-contract count; visible
contract value; buyer-authority count; service-category count; buyer
concentration; expiry clustering; direct-award share (where
source-supported); missing-data score; evidence-confidence score. No
subjective risk scores.

## Confidence framework

Fact states per `docs/PUBLICATION_SAFETY.md`. Numeric scores (0–1) are
internal ordering aids only and are never displayed without their state
label.

## Supplier selection (first truth slice)

Only from the captured official list. Scoring per the 10 criteria in
`src/ingest/score_suppliers.py` (source clarity, entity matchability, CH
evidence availability, FTS/CF visibility, record richness, ownership
evidence, name ambiguity, public-profile complexity, truth-slice fit,
failure-mode value). Selection reason recorded in `docs/DECISIONS.md`.
**Not executed this session — blocked at source access; no supplier may be
selected before the official list is captured (mission rule).**

## Model assistance

Permitted only for candidate ranking, classification suggestions,
ambiguity explanation, manual-review support, taxonomy suggestions — each
use writes an audit record (input, instruction summary, model, output,
suggested confidence, why-not-confirmed, what-would-confirm). None used on
real data this session (no real data).
