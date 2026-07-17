# Handoff

For any engineer or model continuing this project cold.

## What this is

An evidence-linked data system connecting official UK government
strategic suppliers to legal entities, Companies House records, public
contract notices, buyers, categories, values/dates, ownership evidence,
and neutral dependency indicators — every displayed fact carrying a
deterministic evidence ID that resolves to a saved, hashed raw source
file. Mission spec: the original build command (see git history of this
branch); operating rules distilled into docs/.

## Current truth (2026-07-17)

- Session environment could not reach ANY required official source
  (egress policy; evidence preserved). Therefore: **no real data exists
  anywhere in this repo.** Everything data-like under `tests/fixtures/`
  is synthetic and loudly labelled.
- Release state: BLOCKED / NEEDS HUMAN DECISION.
  Artifact level: METHODOLOGY AND DATA-SPINE PACKAGE.
- The full pipeline (adapters → lock → normalise → resolve → indicators →
  slice → gates → render) is implemented and passes a 27-check end-to-end
  fixture test offline.

## The five things you must internalise before touching anything

1. **Evidence classes.** Only `EVIDENCE`-class raw captures may support
   displayed facts. `ACCESS_TEST`, `LOCATOR_ONLY`, `MODEL_MEDIATED_FETCH`,
   `SYNTHETIC_TEST_FIXTURE` never can. (schemas/source_lock.schema.json)
2. **Fact states.** CONFIRMED / PROBABLE / POSSIBLE / UNRESOLVED /
   CONFLICTING. Model inference never confirms anything. Exact-name match
   alone is only PROBABLE.
3. **Fetch/build separation.** Only `fetch_*` commands touch the network;
   everything else must rebuild identically from `data/raw/`. Raw files
   are immutable once locked.
4. **Firewalls.** Secrets gate, fixture firewall, prohibited-wording
   scan, public-claim firewall, operator review gate. All must pass; none
   may be weakened to make progress.
5. **Honest levels.** Do not claim a higher artifact level than the gates
   support. Blocked is an acceptable state; false certainty is not.

## Map

- Entry point: `scripts/atlas.py` (22 commands; `--help`).
- State: `data/validation/status.json`, `docs/CHECKPOINTS.md`,
  `docs/RUN_LEDGER.md`.
- Resume: `docs/CONTINUE_HERE.md` → `docs/NEXT_COMMANDS.md`.
- Blockers + unblock: `docs/SOURCE_ACCESS_LOG.md`, `docs/RELEASE_STATE.md`.
- Decisions and why: `docs/DECISIONS.md`.
- What "done" means for the first supplier: `docs/ONE_SUPPLIER_TRUTH_SLICE.md`.

## Operator asks (the two human decisions pending)

1. Grant network access: allowlist the seven official hosts in the
   environment's network policy, or run the pipeline locally.
2. Optionally provide `COMPANIES_HOUSE_API_KEY` (free) for CH enrichment.

No other human input is needed until the operator review gate before any
public release.
