# Data sources

Registry of official sources for the atlas. Every displayed fact must trace
to one of these sources via a saved raw file, a source-lock entry, and an
evidence ID.

**Session status (2026-07-17): ALL sources below are unreachable from this
session — the execution environment's egress policy denies CONNECT to every
required host (see `docs/SOURCE_ACCESS_LOG.md` and
`data/raw/source_probe/probe_report.json`). Nothing in this repository is
real source data yet.** URL/licence/limit fields marked *(to verify)* are
from documented public knowledge of these services and MUST be re-verified
against the live source before any data is displayed.

Evidence-ID source codes: `GOVUK`, `FAT` (Find a Tender), `CF`
(Contracts Finder), `CH` (Companies House).

---

## 1. GOV.UK — Crown Representatives and strategic suppliers (official list)

| Field | Value |
|---|---|
| Role in atlas | The authoritative definition of "official strategic supplier". Root of every supplier node. |
| Owner | Cabinet Office, published on GOV.UK |
| Canonical page | `https://www.gov.uk/government/publications/crown-representatives-and-strategic-suppliers` (located via WebSearch 2026-07-17; see `data/raw/source_probe/websearch_locator_govuk_publication.json` — LOCATOR ONLY, page itself not yet retrieved) |
| Machine access | GOV.UK content API: `https://www.gov.uk/api/content/government/publications/crown-representatives-and-strategic-suppliers` *(to verify)* |
| Attachments | Publication attachments served from `https://assets.publishing.service.gov.uk/...` *(to verify)* |
| Auth | None |
| Licence | Open Government Licence v3.0 expected for GOV.UK content *(to verify from page footer/attachment)* |
| Stable IDs | GOV.UK `content_id`; attachment filename + row/entry position |
| Evidence ID pattern | `SRC-GOVUK-{yyyymmdd}-STRATEGIC_SUPPLIER_LIST_{rownn}-{FIELD}` |
| Citation method | Link to publication page + attachment; quote row/passage |
| Rate limits | None documented for content API; be polite *(to verify)* |
| Access status this session | **BLOCKED (egress policy, CONNECT 403)** |

## 2. Find a Tender Service (FTS) — OCDS release packages

| Field | Value |
|---|---|
| Role in atlas | Above-threshold UK public procurement notices (tender/award/contract) in OCDS format; supplier org identifiers (incl. `GB-COH` company numbers) for entity resolution. |
| Owner | UK Government (Cabinet Office / Government Commercial Function) |
| API | `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=...&updatedTo=...` with cursor paging *(param names to verify against live API docs at /apidocumentation)* |
| Auth | None *(to verify)* |
| Licence | Open Government Licence v3.0 expected for OCDS data *(to verify)* |
| Stable IDs | `ocid`, release `id` |
| Evidence ID pattern | `SRC-FAT-{yyyymmdd}-{OCID}-{FIELD}` |
| Citation method | Link to notice page `https://www.find-tender.service.gov.uk/Notice/{id}` + OCID; quote field |
| Rate limits | Documented per-window limits on the API *(to verify exact numbers)* |
| Known limitation | No keyword search on the OCDS API — date-window harvest, then local filtering. |
| Access status this session | **BLOCKED (egress policy, CONNECT 403)** |

## 3. Contracts Finder — search + OCDS

| Field | Value |
|---|---|
| Role in atlas | Below-threshold and historical notices; keyword search path for supplier-visibility probing and truth-slice record discovery. |
| Owner | UK Government |
| APIs | OCDS harvester: `.../Published/Notices/OCDS/Search?publishedFrom=...&publishedTo=...`; REST v2 keyword search: `.../api/rest/2/search_notices/json?keyword=...&size=...` *(both to verify against /apidocumentation)* |
| Auth | None *(to verify)* |
| Licence | Open Government Licence v3.0 expected *(to verify)* |
| Stable IDs | `ocid` / notice id |
| Evidence ID pattern | `SRC-CF-{yyyymmdd}-{NOTICEID}-{FIELD}` |
| Citation method | Link to notice page + id; quote field |
| Rate limits | None published; adapter enforces ≥1s politeness delay *(to verify)* |
| Access status this session | **BLOCKED (egress policy, CONNECT 403)** |

## 4. Companies House — public data API

| Field | Value |
|---|---|
| Role in atlas | Legal-entity ground truth: company profile, registered name/number/status, previous names, registered office, PSC (org-level by default). |
| Owner | Companies House |
| API | `https://api.company-information.service.gov.uk/company/{number}`, `/company/{number}/persons-with-significant-control`, `/search/companies?q=...` |
| Auth | **API key required** — `COMPANIES_HOUSE_API_KEY` (free registration; HTTP Basic username). Key is NOT present in this session. |
| Licence | Companies House data reusable under its published terms; personal-data caution applies to PSC/officer fields (see `docs/PUBLICATION_SAFETY.md`) *(to verify exact terms text)* |
| Stable IDs | `company_number` |
| Evidence ID pattern | `SRC-CH-{yyyymmdd}-{COMPANY_NUMBER}-{FIELD}` |
| Citation method | Link to `https://find-and-update.company-information.service.gov.uk/company/{number}` (LINK-ONLY page) + API field |
| Rate limits | 600 requests / 5 minutes per key *(to verify)* |
| Key-free fallback | Free Company Data Product bulk snapshot at `https://download.companieshouse.gov.uk/en_output.html` (~hundreds of MB; monthly; no PSC) — lawful fallback for profile basics. Also blocked this session. |
| Access status this session | **BLOCKED (egress policy, CONNECT 403) + missing API key** |

## 5. Companies House — public web profile pages

| Field | Value |
|---|---|
| Role in atlas | LINK-ONLY citation target so a reader can verify company records. Never scraped. |
| URL pattern | `https://find-and-update.company-information.service.gov.uk/company/{number}` |
| Access status this session | **BLOCKED (egress policy, CONNECT 403)** |

---

## Secondary sources (corroboration / manual review only)

- UK Parliament committee publications (e.g. Public Accounts Committee
  strategic-suppliers material) — corroboration in manual review, never a
  primary evidence source for supplier designation.
- No paid databases. No search-engine snippets as evidence (locator use
  only, always labelled `LOCATOR_ONLY`).

## Blocked-as-evidence

- WebSearch snippets: `LOCATOR_ONLY`.
- Harness WebFetch output: would be model-mediated (not byte-exact); if it
  is ever the only available path, its records must be classed
  `MODEL_MEDIATED_FETCH`, capped below CONFIRMED, and re-captured directly
  before public display. (Moot this session: WebFetch is policy-blocked for
  all required hosts.)
