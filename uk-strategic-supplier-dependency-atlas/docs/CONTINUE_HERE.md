# Continue here

You are picking up the UK Strategic Supplier Dependency Atlas. Read
`docs/PROJECT_STATE.md` first (30 seconds), then act on whichever of the
two situations applies.

## Situation A — source access is still blocked

Do NOT build further data features; everything buildable without data is
built. Useful remaining work: none critical. Verify health only:

```bash
python3 tests/test_pipeline_fixture.py     # expect 27/27
python3 scripts/atlas.py run_acceptance_gates   # expect 5 pass / 0 fail / 5 blocked
```

Then stop and ask the operator for the unblock (network allowlist and/or
local run + optional CH key). The blocked-host list and instructions are
in `docs/SOURCE_ACCESS_LOG.md`.

## Situation B — source access works now

Follow `docs/NEXT_COMMANDS.md` top to bottom. Summary:

1. `python3 scripts/atlas.py probe_sources` → must print PASS or PARTIAL.
2. `python3 scripts/atlas.py fetch_suppliers` → capture the official list;
   **inspect the parsed rows** (`python3 src/ingest/govuk_strategic_suppliers.py --offline`).
   If the attachment format defeats the parser, extend the parser — never
   type the list in.
3. `python3 scripts/atlas.py lock_sources` after every fetch batch.
4. Verify adapter field mappings against one real FTS and one real CF
   payload (they are marked *(verify live)* in docs/SOURCE_ADAPTERS.md);
   fix `src/normalize/ocds.py` mappings if reality differs.
5. Capture live licence/terms pages; update
   `docs/LICENCE_AND_TERMS_REVIEW.md` from PROVISIONAL to verified.
6. `score_suppliers --online`, choose the first supplier (evidence-clean,
   non-trivial), record the reason in docs/DECISIONS.md (checkpoint CP4).
7. Fetch procurement + CH for that supplier, `build_truth_slice`,
   `run_acceptance_gates` until 0 fail/0 blocked on slice gates,
   `render_static_profile` (CP6–CP8).
8. Only then consider the mini cohort (`expand_mini_cohort` is gated).

## Invariants you must not break

- Real facts only from `EVIDENCE`-class raw captures under data/raw/.
- Fact states are conservative; model assistance can never confirm.
- outputs/ must stay fixture-free (gate enforces).
- No public anything without the operator review gate.
