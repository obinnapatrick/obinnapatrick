# Data dictionary

Core entities (JSON Schemas in `schemas/`; processed stores in
`data/processed/`).

| Entity | Store | Key | Meaning |
|---|---|---|---|
| StrategicSupplier | `strategic_suppliers.jsonl` | `supplier_id` | A name on the official GOV.UK strategic supplier list, with list-capture evidence |
| LegalEntity | `legal_entities.jsonl` | `entity_id` | Candidate/matched registered company for a supplier, with match method + fact state |
| CompaniesHouseRecord | `companies_house.jsonl` | `company_number` | Minimised CH profile evidence (name, status, previous names, SIC, org-level PSC) |
| ContractRecord | `contracts.jsonl` | `record_id` (ocid/notice id) | One procurement notice/award with buyer, suppliers, value, dates, CPV, stage |
| PublicBody | `public_bodies.jsonl` | `body_id` | Buyer authority aggregated from contract records |
| OwnershipOrControlEdge | `ownership_edges.jsonl` | `edge_id` | Evidenced ownership/control/group relationship; minimisation flag mandatory |
| SourceEvidence | `evidence_ledger.jsonl` | `evidence_id` | Ledger record: raw path + JSON pointer + value + provenance + fact state |
| ConfidenceAssessment | embedded / `confidence.jsonl` | `assessment_id` | Fact-state assessment with evidence for/against |
| DependencyIndicator | `indicators.jsonl` | `indicator_id` | Neutral structural metric with formula + inputs + limitations |
| ManualReviewItem | `data/manual_review/queue.jsonl` | `item_id` | Unresolved/ambiguous case with recommended next step |
| Finding | `outputs/findings/findings.jsonl` | `finding_id` | Cautious, firewalled statement (none generated yet) |
| SourceLockEntry | `data/processed/source_lock.jsonl` | `local_raw_path` | Hash-locked raw capture registration |
| AcceptanceGate | `data/validation/acceptance_gates.json` | `gate_id` | Machine-readable pass/fail/blocked gate result |
| Checkpoint | `data/validation/checkpoints.json` | `checkpoint_id` | Phase checkpoint record |
| PipelineStatus | `data/validation/status.json` | — | Current machine-readable project state |

Field-level definitions live in each schema file; display fields must map
1:1 to schema fields plus an `evidence_id`.

Truth slice: `data/processed/truth_slice_{supplier_id}.json` — the
assembled one-supplier graph slice consumed by the renderer.
