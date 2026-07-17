# Checkpoints
Machine-readable twin: `data/validation/checkpoints.json`.

## CP0 — Repository created [PASS]
- phase: PHASE 0  
- at: 2026-07-17T09:28:23Z
- completed: repository scaffold; required directory tree; git branch claude/uk-supplier-dependency-atlas-ukhu0y; stdlib utilities (raw saving, evidence IDs, ledger, status)
- next command: `python3 scripts/atlas.py probe_sources`
- continuation: Project lives in uk-strategic-supplier-dependency-atlas/ inside the obinnapatrick/obinnapatrick repo.

## CP1 — Source spine verified [BLOCKED]
- phase: PHASE 0 source spine  
- at: 2026-07-17T11:08:13Z
- completed: probe module; 2 probe runs over 8 official hosts; failure evidence with timestamps; WebFetch/WebSearch policy tests; canonical publication URL located (LOCATOR_ONLY); docs/DATA_SOURCES.md; docs/SOURCE_ACCESS_LOG.md
- missing: any evidence-grade raw capture
- blocker: egress policy denies www.gov.uk, assets.publishing.service.gov.uk, www.find-tender.service.gov.uk, www.contractsfinder.service.gov.uk, api.company-information.service.gov.uk, find-and-update.company-information.service.gov.uk, download.companieshouse.gov.uk
- next command: `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1  (on a local machine; see docs/WINDOWS_QUICKSTART.md)`
- continuation: Still BLOCKED in the remote environment. The local execution bridge is now the unblock path: one command on any normal machine runs source proof through Level 4.

## CP2 — Source-lock manifest created [PASS]
- phase: source lock  
- at: 2026-07-17T09:28:23Z
- completed: docs/SOURCE_LOCK_MANIFEST.md (mechanism + evidence classes); lock_sources command; data/processed/source_lock.jsonl (10 entries, 0 evidence-grade); hash-immutability check
- missing: evidence-grade entries (blocked upstream)
- next command: `python3 scripts/atlas.py lock_sources`
- continuation: Manifest mechanism proven; every raw file hashed and registered; rebuild-from-raw enforced by design.

## CP3 — Source adapters specified [PASS]
- phase: adapters  
- at: 2026-07-17T09:28:23Z
- completed: docs/SOURCE_ADAPTERS.md (5 contracts); data/processed/source_adapters.json (schema-validated); adapter code: GOV.UK list, FTS OCDS, Contracts Finder, Companies House (key-aware, minimising), terms capture; all adapters offline-capable
- missing: live payload verification of field mappings
- next command: `python3 scripts/atlas.py build_source_adapters`
- continuation: Field mappings written against documented API structure; marked (verify live) in contracts.

## CP4 — Supplier shortlist scored [BLOCKED]
- phase: supplier shortlist  
- at: 2026-07-17T11:08:13Z
- completed: scoring module with 10 criteria; name-ambiguity heuristic; provisional-score guard
- missing: captured official list; live visibility probes; scored table; first-supplier selection
- blocker: no official-list capture possible (egress policy)
- next command: `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1`
- continuation: Selection runs automatically inside the local bootstrap (guardrails: >=3 CF hits, low ambiguity; stops for operator choice via -Supplier otherwise).

## CP5 — Graph schema created [PASS]
- phase: graph schema  
- at: 2026-07-17T09:28:23Z
- completed: 17 JSON schemas; evidence-ID rule implemented; provenance classes; fact states; manual-review schema; docs/METHODOLOGY.md; docs/DATA_DICTIONARY.md
- next command: `python3 tests/test_pipeline_fixture.py`
- continuation: Schema-lite validator enforces required/enum/type; full validation depth documented as a limitation.

## CP6 — One-supplier truth slice built [BLOCKED]
- phase: one-supplier truth slice  
- at: 2026-07-17T09:28:23Z
- completed: truth-slice builder (offline, deterministic); entity-resolution ladder; indicators engine; ownership edges from PSC; 27/27 fixture e2e checks pass
- missing: real truth slice (needs evidence-grade captures)
- blocker: source access BLOCKED
- next command: `python3 scripts/atlas.py probe_sources  # after allowlisting hosts per docs/SOURCE_ACCESS_LOG.md`
- continuation: Machinery fixture-proven end-to-end; no real data may be processed until source access exists.

## CP7 — Acceptance gates passed [BLOCKED]
- phase: acceptance gates  
- at: 2026-07-17T09:28:23Z
- completed: gate engine + data/validation/acceptance_gates.json; secrets gate PASS; fixture firewall PASS; publication-safety PASS; source-lock gates PASS
- missing: GATE-SRC-01, GATE-LIC-01, GATE-SCHEMA-01, GATE-PROV-01, GATE-SLICE-01 (all blocked on access)
- blocker: source access BLOCKED
- next command: `python3 scripts/atlas.py run_acceptance_gates`
- continuation: 5 pass / 0 fail / 5 blocked; every blocked gate carries its unblock action.

## CP8 — Static supplier profile rendered [BLOCKED]
- phase: static profile  
- at: 2026-07-17T09:28:23Z
- completed: renderer with evidence panels, fact-state labels, manual-review view, rebuild command; fixture render verified (banner, evidence chips, no prohibited wording)
- missing: real supplier profile under outputs/profiles/
- blocker: source access BLOCKED
- next command: `python3 scripts/atlas.py probe_sources  # after allowlisting hosts per docs/SOURCE_ACCESS_LOG.md`
- continuation: Renderer is ready; outputs/profiles stays empty until a real slice passes gates.

## CP12 — Release state decided [PASS]
- phase: release state  
- at: 2026-07-17T09:28:23Z
- completed: docs/RELEASE_STATE.md; docs/OPERATOR_REVIEW_GATE.md; status.json release_state=BLOCKED_NEEDS_HUMAN_DECISION
- next command: `python3 scripts/atlas.py decide_release_state`
- continuation: Honest classification: BLOCKED / NEEDS HUMAN DECISION; artifact level = METHODOLOGY AND DATA-SPINE PACKAGE. CP9-CP11 (mini cohort, validation, findings) intentionally not created: they cannot exist before a real truth slice.
