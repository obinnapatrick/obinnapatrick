# Validation

## Status (2026-07-17)

No real data exists (source access BLOCKED), so gold-set validation has
not started. What HAS been validated is the machinery itself, end-to-end,
on synthetic fixtures — see below. Nothing in this section claims
real-data quality.

## Machinery validation (fixture mode, 27/27 checks pass)

`python3 tests/test_pipeline_fixture.py` proves:

- official-list parsing with per-row evidence IDs;
- OCDS normalisation with per-field evidence (title, buyer, supplier,
  identifier, value, dates, CPV, procedure);
- entity-resolution ladder and conservative fact states
  (exact+identifier+CH ⇒ CONFIRMED; exact-only ⇒ PROBABLE; variant ⇒
  POSSIBLE + manual-review item; unrelated supplier excluded);
- CH merge, org-level PSC ⇒ one PROBABLE ownership edge, no
  personal-data review triggered for corporate PSC;
- indicator formulas (headline counts exclude POSSIBLE; value sums only
  valued GBP records; direct-award share only over notices that publish a
  procedure type);
- truth-slice assembly with a fully resolvable evidence ledger (schema
  validation and provenance resolution both zero-error);
- static rendering with fixture banner, evidence chips, fact-state labels;
- fixture firewall (outputs/ and data/processed/ stay clean);
- prohibited-wording scan clean;
- deterministic rebuild from raw (volatile timestamps excluded).

## Adversarial review performed (design-level, this session)

| Attack | Result |
|---|---|
| Fixture data leaking into real outputs | Blocked by GATE-FIX-01 + separate fixture output root; test asserts clean |
| Trading-name/suffix confusion creating false CONFIRMED | Caps at POSSIBLE without identifier corroboration; test `fixture-ocds-0003` |
| Unrelated supplier swept in | Excluded; test `fixture-ocds-0004` |
| Model-only confirmation | No model-assist path can set a state above POSSIBLE; audit-trail required by contract |
| Secrets in repo/logs/meta | GATE-SECRET-01 scans incl. literal env values; passes |
| Accusation wording in outputs | GATE-SAFE-01 word-list scan; passes |
| Raw evidence mutated after capture | lock_sources hash check dies on mismatch |
| Displayed claim without evidence | validate_truth_slice resolves every referenced ID + raw path |
| Search snippets used as facts | evidence_class LOCATOR_ONLY cannot support facts |
| Release-state optimism | decide_release_state hard-codes BLOCKED when evidence-grade captures = 0 |

## Gold-set plan (starts when real data exists)

- 30–50 supplier/entity records; 10–20 ownership edges; 30+
  contract-supplier links; 10+ buyers; 10+ category labels; all findings.
- Measured separately: supplier-entity precision (target ≥90%),
  contract-to-supplier precision (≥90%), ownership/control precision
  (≥85%), buyer precision, category precision, source-link completeness
  (≥95%), evidence-ID completeness (100% of displayed claims),
  confidence-label accuracy, unresolved-case handling.
- Below-threshold records route to manual review — the standard is never
  lowered to make the alpha look better.
- Failures recorded here + manual-review items created.

## Known machinery limitations

- Schema validation is required/enum/type depth only (documented).
- Field mappings unverified against live payloads until first unblocked
  run (marked *(verify live)* in adapter contracts).
