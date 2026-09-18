# Local troubleshooting

Every failure preserves completed work. The default recovery is always:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume
```

(macOS/Linux: `bash scripts/bootstrap_local.sh --resume`)

| Symptom | Meaning | Fix |
|---|---|---|
| `Python 3 was not found` | Python missing or not on PATH | Install from python.org, tick "Add python.exe to PATH", open a NEW PowerShell window |
| `running scripts is disabled` when starting the .ps1 | PowerShell execution policy | Use the exact command with `-ExecutionPolicy Bypass` as shown; it affects this run only |
| Preflight: a source shows `UNREACHABLE` | Your network/VPN/firewall blocks that host, or the site is down | Try a browser visit to the printed URL; switch off VPN or use another network; corporate machines may need the file-drop fallback (`data/inbox/README.md`) |
| Preflight: `Classification: BLOCKED` | GOV.UK or both procurement sources unreachable | The run correctly refuses to fabricate. Use a normal home connection, or file-drop official downloads into `data/inbox/` and run `python scripts/atlas.py import_inbox`, then `-Resume` |
| Stopped at `parse_suppliers` (format changed) | GOV.UK changed the list attachment format | Do NOT type the list in. Keep the saved capture; report the file under `data/raw/strategic_suppliers/` to the next Fable session, which must extend the parser |
| Stopped at `select_supplier` (no candidate met guardrails) | Auto-selection refused to guess | Rerun with `-Resume -Supplier "EXACT NAME"` using a name from the printed list |
| `CF keyword fetch failed` / `FTS window fetch failed` | Temporary API error or endpoint drift | Rerun with `-Resume` (fetches retry). If it persists, the API structure may have drifted — save the error text for the next Fable session; the OCDS/REST2 parsers deliberately skip rather than guess |
| Stopped at `fetch_companies_house` with 401 | Key invalid/expired | Re-create the key at developer.company-information.service.gov.uk and set `COMPANIES_HOUSE_API_KEY` again; or unset it to use the key-free path |
| CH returns 429 repeatedly | Rate limit | Wait 5 minutes, `-Resume` |
| `acceptance gates FAILED` | A firewall or evidence rule was violated | Read the printed gate reasons and `data/validation/acceptance_gates.json`; fix (usually rerun `lock_sources` via `-Resume`); never edit raw files |
| `Level-4 verification FAILED` + quarantine message | The rendered profile broke a real-data invariant | Read `data/validation/level4_verification.json`; the bad HTML is in `outputs/profiles/_quarantine/` with reasons; raw evidence is untouched; fix and `-Resume` |
| `hash mismatch for ...` from lock_sources | A raw evidence file was edited after capture | Raw files are immutable. Restore the original (e.g. `git checkout -- <file>`) or delete the modified copy and re-fetch; never hand-edit evidence |
| Garbled characters in the console | Windows code-page issue | The scripts set `PYTHONUTF8=1`; if it persists, run `chcp 65001` first (display-only issue; files are unaffected) |
| `git push` rejected | Remote moved ahead | `git pull origin claude/uk-supplier-dependency-atlas-ukhu0y` then push again |

## Where state lives

- Stage state + resume command: `data/validation/level4_run.json`
- Preflight report: `data/validation/preflight.json`
- Gates: `data/validation/acceptance_gates.json`
- Verification: `data/validation/level4_verification.json`
- Action log: `docs/RUN_LEDGER.md`

## What is never acceptable as a "fix"

Hand-entering supplier names from memory; editing files under
`data/raw/`; copying fixture data out of `tests/fixtures/`; pasting an
API key into any file; deleting the manual-review queue.
