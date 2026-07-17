# Limitations

## Session-level (2026-07-17)

1. **No real data.** Every required official host is egress-policy blocked
   in this execution environment; the repository contains machinery,
   schemas, contracts, probe evidence and synthetic test fixtures only.
2. Licence classifications are provisional (terms pages unreachable).
3. Adapter field mappings are written against documented API structure and
   must be verified against live payloads on first unblocked run.
4. `COMPANIES_HOUSE_API_KEY` is not present; CH enrichment will be limited
   until provided (or the bulk snapshot fallback is used).

## Structural (will apply even when unblocked)

1. **Visibility ≠ dependence.** The atlas measures what appears in
   published notices. Contracts below publication thresholds, call-offs
   under frameworks, classified work, and unpublished extensions are
   invisible; indicator wording must always say "in this dataset".
2. Procurement data quality varies: supplier identifiers are often
   missing or inconsistent; trading names diverge from registered names;
   buyer names are duplicated/inconsistent across notices.
3. Contract values may be estimates, maximums, framework ceilings, or
   absent; value-based indicators are labelled "visible value" only.
4. Ownership/control evidence (PSC) lags corporate events and may name
   intermediate rather than ultimate owners; edges stay UNRESOLVED or
   POSSIBLE unless official evidence supports more.
5. The official strategic supplier list changes over time; supplier
   status is dated to the captured list version.
6. Keyword-search discovery (Contracts Finder) has imperfect recall;
   zero hits is never treated as proof of absence.
7. Above-threshold (FTS) and below-threshold (CF) coverage windows differ;
   cross-source deduplication by ocid is best-effort.
8. Fact states are conservative by design; many true relationships will
   sit at PROBABLE/POSSIBLE for lack of official confirmation. Unresolved
   is acceptable; false certainty is not.
