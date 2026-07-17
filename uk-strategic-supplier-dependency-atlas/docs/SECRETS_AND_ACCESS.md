# Secrets and access review

## Required credentials

| Variable | Service | Needed for | How to obtain | Status this session |
|---|---|---|---|---|
| `COMPANIES_HOUSE_API_KEY` | Companies House public data API | Company profile, previous names, PSC enrichment | Free registration at `https://developer.company-information.service.gov.uk/` → create application → REST key | **Absent** |

No credentials are required for GOV.UK content/attachments, Find a Tender
OCDS, or Contracts Finder.

## Rules (enforced by `python3 scripts/atlas.py check_secrets`)

- No API keys or tokens in source code, README examples, raw data files,
  logs, checkpoints, generated HTML, or committed files of any kind.
- Keys live only in the environment (or an uncommitted `.env`);
  `.env` is gitignored; `.env.example` records variable **names only**.
- The Companies House adapter reads the key from the environment at call
  time and never writes it into saved raw files or metadata (asserted by
  the secrets gate, which scans `data/`, `outputs/`, `docs/`, `src/`,
  `schemas/`, `scripts/` for key-like patterns and for the literal value
  of any key present in the environment).

## Access notes

- This session's outbound HTTPS passes through an organisation
  egress-policy proxy; all required official hosts are denied (CONNECT
  403). This is an environment policy decision, not a credential issue —
  documented in `docs/SOURCE_ACCESS_LOG.md`.
- Proxy credentials/tokens visible in the session environment are
  infrastructure-injected and are never read or recorded by atlas code.
