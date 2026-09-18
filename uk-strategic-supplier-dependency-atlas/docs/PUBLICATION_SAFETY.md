# Publication safety

The atlas shows structure and evidence. It does not make accusations.

## Fact states (non-negotiable)

Every displayed fact, node and edge carries exactly one of:

- `CONFIRMED` — directly supported by official source evidence.
- `PROBABLE` — strong evidence, not sufficient for confirmed.
- `POSSIBLE` — candidate match requiring further review.
- `UNRESOLVED` — insufficient evidence.
- `CONFLICTING` — plausible records/sources contradict each other.

Model inference alone can never confirm: legal-entity identity, ownership,
control, parent-company relationship, contract attribution, direct-award
classification, public-body dependency.

## Language rules

Allowed (neutral, structural): dependency concentration; contract
exposure; expiry clustering; public-body concentration; supplier
concentration; ownership evidence; control evidence; group relationship;
unresolved ownership path; confidence level; evidence completeness;
direct-award share where source-supported.

Prohibited in all outputs (machine-checked by the publication-safety gate;
list mirrored in `src/validation/gates.py`): corrupt; captured; unsafe;
compromised; fragile; suspicious; exploitative; failure risk; monopoly
abuse; scandal; misconduct; cronyism; profiteering; dangerous; rigged;
shady; cartel; captured state; profiteer.

## Personal data minimisation

- Default display level is the organisation. Individual PSC names appear
  only when necessary to explain an official ownership/control record,
  and only from official public records.
- Never include personal addresses, full dates of birth, or other
  unnecessary personal details in any output. The Companies House adapter
  strips residential-address and DOB-day fields at ingest.
- Data-minimisation decisions are recorded here.

### Decisions log

- 2026-07-17: CH adapter written to retain PSC month/year of birth only if
  ever needed for disambiguation in manual review, and to exclude it from
  all processed/display outputs; residential address fields never stored.
  (No real data ingested yet.)

## Public findings

No finding may be public before it passes the public-claim firewall
(`outputs/findings/public_claim_review.json`; schema
`schemas/public_claim_review.schema.json`) — see the ten mandatory
questions in the mission spec and `scripts/atlas.py run_public_claim_firewall`.

Allowed finding shape: "In this alpha dataset, Supplier X appears in Y
linked notices across Z buyer authorities. This is an alpha-stage
visibility indicator, not a complete measure of all public-sector
dependence."

## Current status

No outputs exist that could be published (no real data ingested; release
state BLOCKED / NEEDS HUMAN DECISION). The safety gates are implemented
and run against fixture-mode outputs to prove enforcement works.
