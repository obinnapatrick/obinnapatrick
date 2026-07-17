# Source adapter contracts

One contract per source. Implementations live in `src/`; every adapter
must be able to run **offline from saved raw files** (`--offline`), which
is how reproducibility is guaranteed and how the pipeline was exercised
this session (fixtures only, clearly labelled).

Field mappings marked *(verify live)* were written against the documented
public structure of each API and must be checked against a real payload on
first unblocked run; adapters fail loudly (structured error, manual-review
item) rather than guessing when a field is absent.

---

## Adapter 1: `govuk_strategic_suppliers` (`src/ingest/govuk_strategic_suppliers.py`)

| Contract field | Value |
|---|---|
| Source | GOV.UK publication "Crown Representatives and strategic suppliers" |
| Access method | GET content API JSON → discover attachments → GET attachment(s) (CSV/ODS/HTML) |
| Auth | None |
| Rate/use limits | None documented; 1s politeness delay |
| Raw payloads | `data/raw/strategic_suppliers/govuk_content_{yyyymmdd}.json`, `data/raw/strategic_suppliers/attachment_{yyyymmdd}_{name}` |
| Normalised output | `data/processed/strategic_suppliers.jsonl` (schema `strategic_supplier.schema.json`) |
| Stable record ID | GOV.UK `content_id` + list row ordinal |
| Evidence fields | supplier name (verbatim), list publication date, attachment name, row ordinal, crown-representative column if present *(verify live)* |
| Evidence IDs | `SRC-GOVUK-{date}-STRATEGIC_SUPPLIER_LIST_ROW{nn}-SUPPLIER_NAME` |
| Citation | Publication URL + attachment filename + row |
| Known limitations | List format may be CSV, ODS or page body; parser tries CSV → ODS (stdlib zip+XML) → HTML body list and records which path ran; publication updates replace attachments (keep dated captures) |
| Failure behaviour | Non-2xx or zero suppliers parsed → structured `SourceAccessFailure` + manual-review item; never silent |
| Freshness | Re-capture per run; compare sha256 to detect list changes |
| Offline capable | Yes (`--offline` parses newest saved capture) |

## Adapter 2: `find_a_tender` (`src/ingest/find_a_tender.py`)

| Contract field | Value |
|---|---|
| Source | Find a Tender OCDS API |
| Access method | GET `api/1.0/ocdsReleasePackages?updatedFrom&updatedTo` + cursor paging *(verify param names live)*; per-OCID fetch for targeted re-capture |
| Auth | None *(verify)* |
| Rate/use limits | Politeness delay ≥1s; respect documented limits *(verify)* |
| Raw payloads | `data/raw/procurement/fts_packages_{yyyymmdd}_{seq}.json` |
| Normalised output | `data/processed/contracts.jsonl` via `src/normalize/ocds.py` (schema `contract.schema.json`) |
| Stable record ID | `ocid` + release `id` |
| Evidence fields | buyer name/id, supplier parties (name, identifier scheme/id incl. `GB-COH`), award value/currency/date, contract period, CPV classifications, procedure type |
| Evidence IDs | `SRC-FAT-{date}-{OCID}-{FIELD}` |
| Citation | FTS notice URL + OCID |
| Known limitations | No keyword search — harvest by window then filter locally; above-threshold notices only; supplier identifiers not always populated |
| Failure behaviour | Structured failure record; partial windows recorded in meta; no silent skips |
| Freshness | Immutable snapshots; new windows appended |
| Offline capable | Yes |

## Adapter 3: `contracts_finder` (`src/ingest/contracts_finder.py`)

| Contract field | Value |
|---|---|
| Source | Contracts Finder |
| Access method | REST v2 keyword search `api/rest/2/search_notices/json?keyword=&size=` for discovery *(verify)*; OCDS harvester `Published/Notices/OCDS/Search?publishedFrom&publishedTo` for bulk *(verify)* |
| Auth | None *(verify)* |
| Rate/use limits | None published; 1s politeness delay |
| Raw payloads | `data/raw/procurement/cf_search_{keyword}_{yyyymmdd}.json`, `cf_ocds_{yyyymmdd}_{seq}.json` |
| Normalised output | `data/processed/contracts.jsonl` (shared normaliser) |
| Stable record ID | notice id / `ocid` |
| Evidence fields | as Adapter 2; CF additionally covers below-threshold notices |
| Evidence IDs | `SRC-CF-{date}-{NOTICEID}-{FIELD}` |
| Citation | CF notice URL + id |
| Known limitations | Keyword search recall is imperfect (trading names!); results deduplicated against FTS by ocid where both exist |
| Failure behaviour | Structured failure; keyword-zero-hits recorded as evidence of low visibility, not treated as proof of absence |
| Freshness | Immutable snapshots |
| Offline capable | Yes |

## Adapter 4: `companies_house` (`src/companies_house/adapter.py`)

| Contract field | Value |
|---|---|
| Source | Companies House public data API |
| Access method | GET `/company/{number}`, `/company/{number}/persons-with-significant-control`, `/search/companies?q=` with HTTP Basic (key as username) |
| Auth | `COMPANIES_HOUSE_API_KEY` required |
| Rate/use limits | 600 req / 5 min *(verify)*; adapter throttles to ≤1 req/s |
| Raw payloads | `data/raw/companies_house/{number}_profile_{yyyymmdd}.json`, `{number}_psc_{yyyymmdd}.json`, `search_{query}_{yyyymmdd}.json` |
| Normalised output | `data/processed/companies_house.jsonl` (schema `companies_house_record.schema.json`) |
| Stable record ID | `company_number` |
| Evidence fields | company_name, company_number, status, type, incorporation date, registered office (locality/postcode only), previous names, SIC codes, PSC entries (org-level; person names only where control record requires) |
| Evidence IDs | `SRC-CH-{date}-{COMPANY_NUMBER}-{FIELD}` |
| Citation | LINK-ONLY web profile URL + API field name |
| Known limitations | Requires key; PSC may lag reality; data minimisation strips residential addresses and DOB day at ingest |
| Failure behaviour | Missing key → structured `SourceAccessFailure('missing_credential')`; 429 → backoff + resume; never fabricates |
| Freshness | Dated captures per rebuild |
| Offline capable | Yes |

## Adapter 5: `govuk_terms_capture` (part of `lock_sources` flow)

Captures licence/terms pages (OGL statement, FTS/CF API docs, CH developer
terms) as raw evidence for `docs/LICENCE_AND_TERMS_REVIEW.md`
re-verification. Same save/lock rules; class `EVIDENCE`.

---

## Cross-cutting rules

- Every fetch saved raw with `.meta.json` (URL, params, method, timestamp,
  sha256) before any parsing.
- Every extracted field carries `{evidence_id, raw_path, json_pointer,
  retrieved_at, transformation}` — see `schemas/evidence.schema.json`.
- Adapters never write into `outputs/`; only build/render steps do.
- Fixture mode: adapters accept an alternate raw root (used by tests with
  `tests/fixtures/raw/`); fixture IDs carry the `FIXTURE` marker and the
  fixture firewall gate fails if any appear under `outputs/` or
  `data/processed/`.
