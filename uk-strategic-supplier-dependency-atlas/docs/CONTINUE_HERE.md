# Continue here

Read `docs/PROJECT_STATE.md` first (30 seconds), then pick your
situation.

## Situation A — you are a human operator with a normal computer

The project is waiting for exactly you. Follow
`docs/WINDOWS_QUICKSTART.md` (macOS/Linux: `bash
scripts/bootstrap_local.sh`). One command runs everything from source
probe to the verified Level-4 profile and prints the output path. Then
commit and push as the quickstart shows.

## Situation B — you are a model session WITHOUT access to the official hosts

(That includes the original remote Claude environment.) Everything
buildable without data is built. Verify health only:

```bash
python3 tests/test_pipeline_fixture.py      # expect 27/27
python3 tests/test_local_bridge.py          # expect 23/23
python3 scripts/preflight_local.py          # expect honest BLOCKED here
python3 scripts/atlas.py run_acceptance_gates
```

Then hand the operator `docs/WINDOWS_QUICKSTART.md`. Do not fabricate
data; do not weaken gates.

## Situation C — you are a model session WITH access (policy changed) or auditing after the local Level-4 run

- Access now works here: `python3 scripts/run_level4.py` (same
  orchestrator the bootstrap uses), then commit/push.
- Level-4 already ran locally and was pushed: execute the
  "After Level 4" Fable command at the bottom of
  `docs/NEXT_COMMANDS.md` (audit → field-mapping verification → licence
  verification → re-decide state → mini cohort).

## Invariants you must not break (all situations)

- Real facts only from `EVIDENCE`-class raw captures under `data/raw/`.
- Suppliers only from the captured official list — never memory.
- Conservative fact states; model assistance can never confirm.
- `outputs/` stays fixture-free (gate + verifier enforce).
- Raw evidence is immutable once locked.
- Nothing public without the operator review gate.
