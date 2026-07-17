# Licence and terms review

**Status: PROVISIONAL.** The live terms pages are unreachable this session
(egress policy). Classifications below are drawn from documented public
knowledge of these services and MUST be re-verified against the live
licence/terms text before anything is publicly displayed. Until that
re-verification is recorded here with a saved raw copy of each terms page,
**every source is treated as at most PRIVATE ANALYSIS ONLY** and the atlas
must not publish.

Classification scale: PUBLIC DISPLAY SAFE / PRIVATE ANALYSIS ONLY /
LINK-ONLY / BLOCKED.

| Source | Owner | Expected licence | Attribution | Redistribution of raw | Provisional class | Re-verify from |
|---|---|---|---|---|---|---|
| GOV.UK publication content + attachments | Cabinet Office / GOV.UK | Open Government Licence v3.0 | Required (OGL statement + link) | Expected yes under OGL | **Expected PUBLIC DISPLAY SAFE — currently PRIVATE ANALYSIS ONLY pending verification** | Publication page footer; attachment metadata |
| Find a Tender OCDS data | UK Government | OGL v3.0 | Required | Expected yes | **Expected PUBLIC DISPLAY SAFE — currently PRIVATE ANALYSIS ONLY pending verification** | FTS API documentation / site terms |
| Contracts Finder data | UK Government | OGL v3.0 | Required | Expected yes | **Expected PUBLIC DISPLAY SAFE — currently PRIVATE ANALYSIS ONLY pending verification** | CF API documentation / site terms |
| Companies House API data | Companies House | CH API terms; data largely reusable; personal-data caution for PSC/officers | Required (source + link) | Field-level care; org-level display default | **Expected PUBLIC DISPLAY SAFE (org-level) — currently PRIVATE ANALYSIS ONLY pending verification; personal data minimised per docs/PUBLICATION_SAFETY.md** | CH developer hub terms |
| Companies House web pages | Companies House | Site terms | n/a | Never copied | **LINK-ONLY** (citation links only; no scraping) |
| WebSearch snippets | Search engines | n/a | n/a | n/a | **BLOCKED as evidence** (locator use only) |
| Parliamentary publications | UK Parliament | Open Parliament Licence expected | Required | Expected yes | **PRIVATE ANALYSIS ONLY** (corroboration in manual review; re-verify before any display) |

## Rules in force

- No blocked source in any output.
- No PRIVATE ANALYSIS ONLY material redistributed or displayed.
- Rate limits and acceptable-use notes recorded per adapter in
  `docs/SOURCE_ADAPTERS.md`; adapters enforce politeness delays.
- No scraping of pages whose terms prohibit it; the CH web profile is
  LINK-ONLY by design.
- When in doubt: keep private, document the uncertainty here.

## Re-verification checklist (run when access is restored)

1. Save raw copies of: GOV.UK OGL statement on the publication page, FTS
   terms/API docs, CF terms/API docs, CH developer-hub terms.
2. Add each to the source lock (class `EVIDENCE`).
3. Update the table above with verified classes + quotes.
4. Only then may `decide_release_state` consider any public state.
