# File-drop inbox (lawful fallback)

Use this ONLY when live fetching is impossible on your network. Prefer
the live path (`scripts/bootstrap_local.ps1`), which captures sources
directly with full metadata.

## How to use

1. In your browser, download an official file from one of the allowlisted
   official domains (below) — e.g. the strategic-supplier list attachment
   from GOV.UK, an OCDS JSON package from Find a Tender / Contracts
   Finder, or a Companies House API JSON response.
2. Put the file in this folder.
3. Create a sidecar named exactly `<filename>.source.json` next to it:

```json
{
  "source_url": "https://www.gov.uk/government/publications/crown-representatives-and-strategic-suppliers",
  "retrieved_at": "2026-07-17T10:30:00Z",
  "retrieval_method": "manual browser download"
}
```

4. Validate first, then import:

```powershell
python scripts/atlas.py import_inbox --dry-run
python scripts/atlas.py import_inbox
python scripts/atlas.py lock_sources
```

5. Continue the run: `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume`

## Rules (enforced by the importer)

- Allowlisted official domains only: `www.gov.uk`,
  `assets.publishing.service.gov.uk`, `www.find-tender.service.gov.uk`,
  `www.contractsfinder.service.gov.uk`,
  `api.company-information.service.gov.uk`,
  `find-and-update.company-information.service.gov.uk`,
  `download.companieshouse.gov.uk`. Anything else is refused.
- Missing/invalid sidecar → refused with instructions.
- Unrecognised or ambiguous file structure → refused (the importer never
  guesses what a file is).
- Your original file stays here untouched; a copy is hashed and locked
  into `data/raw/`.
- Companies House files are minimised on import (residential addresses
  and dates of birth removed).
- Every import opens a manual-review item
  (`manual_import_provenance_attestation`, publication status
  `private_only`) — manually imported evidence is NOT treated as fully
  verified until that review is resolved (ideally by re-capturing the
  same record live and comparing hashes).

Supported types: GOV.UK content-API JSON, supplier-list CSV/ODS, OCDS
release packages, Contracts Finder REST2 search JSON, Companies House
company-profile and PSC JSON.
