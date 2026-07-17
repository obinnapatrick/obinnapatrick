# Next commands

Exact resume sequence. Prerequisite: network access to the seven hosts in
`docs/SOURCE_ACCESS_LOG.md` (environment allowlist or local machine);
optionally `COMPANIES_HOUSE_API_KEY` exported.

```bash
cd uk-strategic-supplier-dependency-atlas

# 0. Health check (works offline)
python3 tests/test_pipeline_fixture.py            # 27/27 expected

# 1. Source proof (STOP if BLOCKED)
python3 scripts/atlas.py probe_sources

# 2. Capture the official strategic supplier list + inspect parse
python3 scripts/atlas.py fetch_suppliers
python3 src/ingest/govuk_strategic_suppliers.py --offline

# 3. Capture licence/terms pages, then update docs/LICENCE_AND_TERMS_REVIEW.md
#    (remove PROVISIONAL only after quoting the live terms)

# 4. Lock everything captured so far
python3 scripts/atlas.py lock_sources
python3 scripts/atlas.py run_acceptance_gates

# 5. Verify OCDS field mappings against one real payload each
python3 scripts/atlas.py fetch_procurement --window 2026-07-10T00:00:00 2026-07-16T00:00:00
#    -> open the newest data/raw/procurement/fts_* file; check mappings in
#       src/normalize/ocds.py; fix + note in docs/SOURCE_ADAPTERS.md

# 6. Score suppliers with live visibility probing; select first supplier
python3 scripts/atlas.py score_suppliers --online
#    -> record selection + reason in docs/DECISIONS.md; checkpoint CP4

# 7. Build the first truth slice
python3 scripts/atlas.py fetch_procurement --keyword "<SUPPLIER NAME>"
python3 scripts/atlas.py fetch_companies_house --number <GB-COH id>   # needs key
python3 scripts/atlas.py lock_sources
python3 scripts/atlas.py build_truth_slice --supplier "<SUPPLIER NAME>"
python3 scripts/atlas.py run_acceptance_gates                          # must be 0 fail
python3 scripts/atlas.py render_static_profile --supplier "<SUPPLIER NAME>"

# 8. Re-decide state honestly + refresh handoff
python3 scripts/atlas.py decide_release_state
python3 scripts/atlas.py prepare_operator_review
python3 scripts/atlas.py write_handoff
git add -A && git commit -m "add one-supplier truth slice" && git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y
```

Timeboxes (mission section 4) still apply: 30 min per source-access
issue, 25 min per entity ambiguity, then manual-review item + move on.
