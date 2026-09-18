# Handoff

For any engineer, operator, or model continuing this project cold.

## Git facts (real values, no placeholders)

| Item | Value |
|---|---|
| Remote | `https://github.com/obinnapatrick/obinnapatrick.git` |
| Branch | `claude/uk-supplier-dependency-atlas-ukhu0y` |
| Local-bridge completion commit | `8419a9d73bc263534fb610ee9f655afdaa6e5781` |
| Latest commit | run `git log --oneline -1`; machine-readable in `data/validation/status.json` (`git_commit`) |
| Project directory | `uk-strategic-supplier-dependency-atlas/` inside the repo |

Clone + checkout:

```
git clone https://github.com/obinnapatrick/obinnapatrick.git
cd obinnapatrick
git checkout claude/uk-supplier-dependency-atlas-ukhu0y
cd uk-strategic-supplier-dependency-atlas
```

Optional Companies House key (value never committed or displayed):

```
$env:COMPANIES_HOUSE_API_KEY = "paste-your-key-here"     # Windows PowerShell
export COMPANIES_HOUSE_API_KEY="paste-your-key-here"     # macOS/Linux
```

One-command local execution (Windows primary):

```
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1
```

(macOS/Linux: `bash scripts/bootstrap_local.sh`)

Expected output: `outputs/profiles/SUP-<supplier-id>.html` — exact path
printed at the end of the run and stored in
`data/validation/level4_run.json` (`profile_path`).

Resume after any stop:

```
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume
```

(add `-Supplier "NAME"` if the run asked you to choose the supplier)

After Level 4 succeeds: push the results and paste the "After Level 4"
Fable command from `docs/NEXT_COMMANDS.md` into a new session.

## What this is

An evidence-linked data system connecting official UK government
strategic suppliers to legal entities, Companies House records, public
contract notices, buyers, categories, values/dates, ownership evidence,
and neutral dependency indicators — every displayed fact carrying a
deterministic evidence ID that resolves to a saved, hashed raw source
file.

## Current truth (2026-07-17, session 2)

- The original remote build environment cannot reach ANY required
  official source (egress policy; evidence preserved), so **no real data
  exists in this repo yet**. Everything data-like under `tests/fixtures/`
  is synthetic and loudly labelled.
- Release state: BLOCKED / NEEDS HUMAN DECISION. Artifact level:
  METHODOLOGY AND DATA-SPINE PACKAGE **plus a tested local execution
  bridge** — the repository is now locally executable by a
  non-specialist and drives itself to Level 4 (one verified real
  supplier profile) with the one command above.
- Machinery proof: 27/27 end-to-end pipeline checks and 23/23 local
  bridge checks pass offline; acceptance gates run 5 pass / 0 fail /
  5 blocked (each blocked gate names its unblock); the Level-4 verifier
  provably rejects fixture data (`verify_level4.py --selftest`).

## The five things to internalise before touching anything

1. **Evidence classes.** Only `EVIDENCE`-class raw captures support
   displayed facts; `ACCESS_TEST` / `LOCATOR_ONLY` /
   `MODEL_MEDIATED_FETCH` / `SYNTHETIC_TEST_FIXTURE` never can.
2. **Fact states.** CONFIRMED / PROBABLE / POSSIBLE / UNRESOLVED /
   CONFLICTING; exact-name match alone caps at PROBABLE; model
   inference never confirms.
3. **Fetch/build separation.** Only fetch stages touch the network;
   everything rebuilds deterministically from `data/raw/`; raw files are
   immutable once locked (hash-checked).
4. **Firewalls.** Secrets gate, fixture firewall, prohibited-wording
   scan, real-data verifier with quarantine, public-claim firewall,
   operator review gate. None may be weakened to make progress.
5. **Honest levels.** Do not claim a level the gates do not support;
   blocked is acceptable, false certainty is not.

## Map

- Operator entry: `docs/WINDOWS_QUICKSTART.md` →
  `scripts/bootstrap_local.ps1`
- Orchestrator/verify: `scripts/run_level4.py`, `scripts/verify_level4.py`
- Workflow CLI: `scripts/atlas.py` (23 commands; `--help`)
- State: `data/validation/status.json`, `level4_run.json`,
  `acceptance_gates.json`, `docs/CHECKPOINTS.md`, `docs/RUN_LEDGER.md`
- Resume logic: `docs/CONTINUE_HERE.md` → `docs/NEXT_COMMANDS.md`
- Fallback: `data/inbox/README.md`; problems:
  `docs/LOCAL_TROUBLESHOOTING.md`
- Decisions and why: `docs/DECISIONS.md` (D1–D10 + D11 written by the
  selection stage)
