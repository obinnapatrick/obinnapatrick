# Local execution reference

The local execution bridge converts the blocked repository into a
one-command Level-4 run on any machine with ordinary internet access.
Windows-first (`scripts/bootstrap_local.ps1`); macOS/Linux equivalent
(`scripts/bootstrap_local.sh`). Python 3.9+ standard library only — no
virtual environment, no installs, no Docker, no paid services.

## Entry points

| Command | Purpose |
|---|---|
| `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1` | full run (Windows) |
| `bash scripts/bootstrap_local.sh` | full run (macOS/Linux) |
| `python scripts/preflight_local.py` | readiness table only |
| `python scripts/run_level4.py [--resume] [--supplier "X"] [--fts-months N]` | orchestrator directly |
| `python scripts/verify_level4.py` | Level-4 invariant verification only |
| `python scripts/atlas.py import_inbox [--dry-run]` | file-drop fallback import |

## What the bootstrap does, in order

1. Verifies Python 3 and Git; reports versions.
2. No dependency install needed (stdlib-only by design; recorded reason in docs/DECISIONS.md D1).
3. Checks `COMPANIES_HOUSE_API_KEY` presence — never the value.
4. **Preflight** (`data/validation/preflight.json` + access-test evidence
   under `data/raw/source_probe/preflight_*`): tools, repo state, per-host
   reachability, fixture firewall, secrets scan → READY /
   READY_WITH_LIMITATIONS / BLOCKED. BLOCKED stops before any real output.
5. **Stages** (state in `data/validation/level4_run.json`; every stage
   logs to `docs/RUN_LEDGER.md`):
   `probe_sources` → `fetch_suppliers` (official GOV.UK list) →
   `parse_suppliers` → `capture_terms` (licence pages, best-effort) →
   `score_suppliers` (live CF visibility probing) → `select_supplier`
   (guardrails; stops and asks for `--supplier` if no candidate is
   evidence-clean) → `fetch_procurement` (CF keyword; FTS/CF windows if
   fewer than 3 linkable notices) → `fetch_companies_house` (key path or
   documented key-free limitation) → `lock_sources` → `build_truth_slice`
   → `acceptance_gates` (fail = stop) → `decide_release_state` →
   `render_profile` → `verify_level4` → `finalize` (checkpoints CP4/6/7/8,
   handoff refresh, prints the profile path).

## Restartability

Every stage completion is persisted. A failure or controlled stop keeps
all completed work (raw evidence is never deleted) and prints the exact
resume command (`--resume` skips completed fetch stages; preflight, lock,
gates, build, render, and verify always re-run for freshness). The
supplier selection survives restarts in the state file.

## Companies House key behaviour

- **Key present** (`COMPANIES_HOUSE_API_KEY` env var): profile + PSC
  enrichment for up to 3 GB-COH-identified entities, minimised at ingest;
  the key is never printed, logged, or written to disk.
- **Key absent**: the run continues on GB-COH identifiers observed
  directly in procurement records + LINK-ONLY citations; a
  `companies_house_enrichment_unavailable` manual-review item documents
  the limitation, and the profile's Companies House section states it.
  The run only stops if the selected supplier cannot be responsibly
  resolved at all (verifier enforces: no CH evidence AND no documented
  limitation = fail).

## Dual data-acquisition paths

1. **Live fetch (preferred):** official APIs/publications, saved raw +
   hashed + locked exactly as in the remote design.
2. **File-drop fallback:** operator downloads official files in a browser
   into `data/inbox/` with a `<file>.source.json` sidecar, then runs
   `python scripts/atlas.py import_inbox`. See `data/inbox/README.md` for
   the sidecar format and refusal rules (unsupported/ambiguous files and
   non-official domains are refused; CH imports are minimised; every
   import opens a provenance manual-review item and is marked
   `private_only` until reviewed).

## Real-data invariants (enforced by `verify_level4.py`)

The rendered profile is only accepted when: the slice is not
fixture-mode; every evidence record is `EVIDENCE`-class, resolves to an
existing raw file under `data/raw/` whose hash matches the source lock;
the supplier row comes from the captured official list; schemas and
provenance validate; entities ≥1; linked notices ≥3 or a documented
`insufficient_linked_records` review item exists; indicators ≥3; CH
evidence or a documented limitation exists; the HTML contains no fixture
markers, names the supplier, and every evidence chip resolves. On
failure, the HTML is **quarantined** to `outputs/profiles/_quarantine/`
with the reasons (raw evidence untouched) and the run exits non-zero.

`python scripts/verify_level4.py --selftest` proves the verifier rejects
fixture data (used by the test suite).

## After a successful run

```
git add -A
git commit -m "add one-supplier truth slice (local run)"
git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y
```

Then paste the next Fable command from `docs/NEXT_COMMANDS.md` (section
"After Level 4") into a new session.
