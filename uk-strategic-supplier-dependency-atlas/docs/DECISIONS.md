# Decisions

Append-only log of defensible technical decisions.

## D1 — Stack (2026-07-17)

Python 3 stdlib-only pipeline; JSONL evidence ledger + JSON graph store;
static HTML renderer. **SQLite/DuckDB deferred** until the mini cohort:
at one-supplier scale the flat-file store is fully inspectable, diffable
in git, and removes a code path with no query need yet. Revisit at CP9;
the mission's lean-stack default (SQLite) is acknowledged and this is a
recorded deviation with reason.

## D2 — Project placement (2026-07-17)

Built as `uk-strategic-supplier-dependency-atlas/` inside the
`obinnapatrick/obinnapatrick` repo on branch
`claude/uk-supplier-dependency-atlas-ukhu0y` (the session's designated
repo/branch). Extractable as a standalone repo without path changes
(everything is ROOT-relative).

## D3 — Canonical official-list URL via locator (2026-07-17)

Direct fetch impossible (egress policy). Canonical slug
`crown-representatives-and-strategic-suppliers` located via WebSearch and
recorded as `LOCATOR_ONLY` evidence — explicitly NOT source evidence.
The adapter targets that slug and fails loudly if it is wrong.

## D4 — Evidence-class system for degraded retrieval (2026-07-17)

Added `evidence_class` (`EVIDENCE` / `ACCESS_TEST` / `LOCATOR_ONLY` /
`MODEL_MEDIATED_FETCH` / `SYNTHETIC_TEST_FIXTURE`) so that probe failures,
locators and fixtures can be preserved and locked without ever being
usable as displayed-fact support. Only `EVIDENCE` supports displayed
facts.

## D5 — WebFetch rejected as an evidence path (2026-07-17)

Even where harness WebFetch might reach a host, its output is
model-mediated (markdown conversion + small-model extraction, not
byte-exact). Mission rules require raw, hashed, reproducible captures;
so WebFetch output is capped at `MODEL_MEDIATED_FETCH` (no public
display) and was not used for data. Moot in practice: WebFetch was also
policy-blocked for all required hosts (probe evidence saved).

## D6 — Halt before supplier selection (2026-07-17)

Mission rules: "Do not choose the first supplier before the official
source has been saved" and "Do not continue to main build if BLOCKED."
Therefore: no supplier selected, no truth slice on real names, no real
profile rendered. Machinery was instead proven end-to-end on clearly
labelled synthetic fixtures (27 checks), keeping outputs/ contamination-
free (fixture firewall gate enforces this).

## D7 — Conservative fact-state policy in entity resolution (2026-07-17)

Exact name match alone caps at PROBABLE; CONFIRMED requires company-number
corroboration against a captured CH record; suffix/(UK)-variant matches
cap at POSSIBLE and always open a manual-review item. Encoded in
`src/entity_resolution/resolve.py`.

## D8 — Licence classifications provisional ⇒ no public state (2026-07-17)

Terms pages are unreachable; classifications rest on documented knowledge.
Until live terms are captured and the review re-run, everything is at most
PRIVATE ANALYSIS ONLY and `decide_release_state` cannot propose a public
state (enforced via GATE-LIC-01).

## D9 — Release state (2026-07-17)

`BLOCKED_NEEDS_HUMAN_DECISION`, artifact level `METHODOLOGY AND DATA-SPINE
PACKAGE`. Reason: zero evidence-grade captures are possible in this
session; the decision that unblocks the build (network allowlist and/or
local run, plus optional CH key) belongs to a human. See
docs/RELEASE_STATE.md.

## D10 — Data minimisation implemented at ingest, not display (2026-07-17)

The CH adapter redacts residential addresses/DOB before raw files touch
disk (redactions recorded in meta sidecars), so no unminimised personal
data can exist anywhere in the repo. Individual-PSC display additionally
requires a human-resolved manual-review item (publication_status
blocked_until_resolved).
