# Next commands

## Path A — local machine (RECOMMENDED; this is the unblock)

The remote Claude environment cannot reach the official sources, so the
Level-4 run happens on a normal machine. Full non-specialist walkthrough:
`docs/WINDOWS_QUICKSTART.md`. Condensed:

```powershell
cd $HOME\Documents
git clone https://github.com/obinnapatrick/obinnapatrick.git
cd obinnapatrick
git checkout claude/uk-supplier-dependency-atlas-ukhu0y
cd uk-strategic-supplier-dependency-atlas

# optional (run works without it):
$env:COMPANIES_HOUSE_API_KEY = "paste-your-key-here"

powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1
```

Expected result: `outputs\profiles\SUP-<supplier>.html` (exact path
printed at the end), verified by `scripts/verify_level4.py`, with
checkpoints CP4/CP6/CP7/CP8 recorded.

If it stops: it prints the exact resume command (usually
`...bootstrap_local.ps1 -Resume`; add `-Supplier "NAME"` if it asked you
to choose). Troubleshooting: `docs/LOCAL_TROUBLESHOOTING.md`. No-network
fallback: `data/inbox/README.md`.

Afterwards, push the results:

```powershell
cd ..
git add -A
git commit -m "add one-supplier truth slice (local run)"
git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y
```

## Path B — this remote environment (only if the egress policy changes)

```bash
cd uk-strategic-supplier-dependency-atlas
python3 scripts/run_level4.py            # same orchestrator, same stages
```

## After Level 4 — next Fable session command

Paste this into Fable once the real profile is pushed:

```
UK STRATEGIC SUPPLIER DEPENDENCY ATLAS — POST-LEVEL-4 AUDIT AND MINI-COHORT COMMAND

Context: the Level-4 local run has completed and been pushed to branch
claude/uk-supplier-dependency-atlas-ukhu0y. A real one-supplier truth
slice and static profile now exist (data/processed/truth_slice_*.json,
outputs/profiles/*.html, data/validation/level4_verification.json).

Do, in order, on the existing branch without restarting the project:

1. AUDIT: pull the branch; run tests/test_pipeline_fixture.py,
   tests/test_local_bridge.py, scripts/verify_level4.py and
   scripts/atlas.py run_acceptance_gates; independently spot-check 10
   evidence IDs from the profile against their raw files; list every
   discrepancy in docs/VALIDATION.md and fix pipeline bugs found.
2. FIELD-MAPPING VERIFICATION: compare the (verify live) mappings in
   docs/SOURCE_ADAPTERS.md against the real payloads now in data/raw/;
   correct src/normalize/ocds.py and the REST2 parser where reality
   differs; document every correction.
3. LICENCE VERIFICATION: read the captured terms pages under
   data/raw/source_probe/terms_*; update docs/LICENCE_AND_TERMS_REVIEW.md
   from PROVISIONAL to verified classifications with quoted passages, or
   record precisely why verification is still incomplete.
4. RE-DECIDE: rerun decide_release_state and prepare_operator_review;
   the honest expected state is PRIVATE ALPHA.
5. MINI COHORT (only if the audit is clean): select 3-5 suppliers from
   the captured official list spanning distinct failure modes
   (trading-name divergence, group structure, ambiguous name); run the
   same pipeline per supplier; record failure-mode comparison in
   docs/VALIDATION.md; improve entity resolution accordingly.
6. GOLD SET: start the manual gold-set validation per docs/VALIDATION.md
   targets. Do not generate findings until it passes.

Keep all existing invariants: no memory-derived facts, conservative fact
states, fixture firewall, secrets firewall, publication safety, operator
review gate before anything public. Update all continuation docs and
push focused commits to the same branch.
```
