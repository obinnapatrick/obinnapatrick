# Project state

**Last human-readable refresh: 2026-07-17 (session 1).**
Machine twin: `data/validation/status.json` (always current — refresh with
`python3 scripts/atlas.py write_handoff`).

## Headline

- **Release state: BLOCKED / NEEDS HUMAN DECISION**
- **Artifact level: METHODOLOGY AND DATA-SPINE PACKAGE** (mission Level 1
  source-proof + Level 2 data spine, with the Level 3/4 machinery built
  and fixture-proven but legally/technically unable to run on real data
  from this session)
- **Why blocked:** every required official host
  (GOV.UK, assets CDN, Find a Tender, Contracts Finder, Companies House
  API/web/bulk) is denied by this execution environment's egress policy
  (CONNECT 403 at the org proxy — evidence in
  `data/raw/source_probe/probe_report.json`). `COMPANIES_HOUSE_API_KEY`
  is also absent. Harness WebFetch obeys the same policy; WebSearch works
  but snippets are prohibited as evidence.
- **Nothing real was fabricated.** Zero suppliers selected, zero real
  profiles, zero findings. All pipeline proof ran on
  `SYNTHETIC_TEST_FIXTURE` data, firewalled from outputs.

## What exists and works

| Area | State |
|---|---|
| Repository scaffold (required tree) | done |
| Phase 0 probe + failure evidence + access log | done (verdict BLOCKED) |
| Source registry + 5 adapter contracts | done |
| Source-lock manifest mechanism + 10 locked artifacts (0 evidence-grade) | done |
| Secrets firewall (.env.example, docs, gate) | done, gate passes |
| Licence review | PROVISIONAL (re-verify from live terms) |
| 17 JSON schemas + evidence/provenance model | done |
| Adapters: GOV.UK list, FTS OCDS, CF, Companies House (key-aware, minimising) | coded, offline-capable, live mappings to verify |
| Entity-resolution ladder (conservative states) | done, fixture-tested |
| Indicators engine (9 neutral indicators with formulas) | done, fixture-tested |
| Ownership edges from PSC (org-level, minimised) | done, fixture-tested |
| Truth-slice builder (offline, deterministic) | done, fixture-tested |
| Static profile renderer (evidence panels) | done, fixture-tested |
| Acceptance gates (machine-readable) | 5 pass / 0 fail / 5 blocked |
| CLI: 22 workflow commands | done |
| End-to-end fixture test | 27/27 pass |
| Checkpoints CP0–CP8 + CP12 | recorded |
| Operator review gate | prepared (nothing approved) |

## What is blocked (and the exact unblock)

1. **Network egress** to seven hosts (list in docs/SOURCE_ACCESS_LOG.md).
   Fix: allowlist them in this Claude Code environment's network settings
   (https://code.claude.com/docs/en/claude-code-on-the-web) **or** run the
   pipeline on any normal machine.
2. **COMPANIES_HOUSE_API_KEY** (free registration) for CH enrichment —
   optional for the first slice (GB-COH identifiers inside procurement
   data still work), required for CH profile/PSC evidence.

## Danger notes for the next session

- Never select a supplier or hand-enter list rows from memory — the
  adapter fails loudly by design; keep it that way.
- Fixture data must never leave tests/fixtures (GATE-FIX-01 enforces).
- Licence review must be re-verified from live terms before ANY public
  display.
- Raw files are immutable once locked (lock_sources dies on hash change).
