# Release state

- Decided: 2026-07-17T09:27:40Z
- **Release state: BLOCKED NEEDS HUMAN DECISION**
- Artifact level: METHODOLOGY AND DATA SPINE PACKAGE

## Reason

No evidence-grade source capture is possible: every official host is denied by the session's egress policy, and COMPANIES_HOUSE_API_KEY is absent. The machinery, schemas, adapter contracts, gates and fixtures are complete and tested; a human must either allowlist the hosts (and optionally provide the CH key) or run the pipeline in a network-permitted environment.

## Path to the next state

1. Allowlist the seven official hosts (docs/SOURCE_ACCESS_LOG.md) or run locally.
2. `python3 scripts/atlas.py probe_sources` → expect PASS/PARTIAL.
3. Follow docs/NEXT_COMMANDS.md through the truth slice and gates.
4. Verify licences from live terms; update the review doc.
5. Prepare operator review; a human decides any public state.
