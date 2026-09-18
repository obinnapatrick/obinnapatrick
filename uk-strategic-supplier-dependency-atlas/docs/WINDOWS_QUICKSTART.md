# Windows quick start (non-specialist)

Goal: produce the first real Level-4 supplier profile on an ordinary
Windows 11 machine with normal internet access. No coding required.

## 1. One-time setup (about 10 minutes)

1. **Install Python 3** — https://www.python.org/downloads/
   During install, tick **"Add python.exe to PATH"**.
2. **Install Git** — https://git-scm.com/downloads (default options are fine).
3. Open **PowerShell** (Start menu → type "PowerShell" → Enter).

## 2. Get the repository

```powershell
cd $HOME\Documents
git clone https://github.com/obinnapatrick/obinnapatrick.git
cd obinnapatrick
git checkout claude/uk-supplier-dependency-atlas-ukhu0y
cd uk-strategic-supplier-dependency-atlas
```

Already cloned before? Update instead:

```powershell
cd $HOME\Documents\obinnapatrick
git checkout claude/uk-supplier-dependency-atlas-ukhu0y
git pull origin claude/uk-supplier-dependency-atlas-ukhu0y
cd uk-strategic-supplier-dependency-atlas
```

## 3. Optional: Companies House API key

The run works **without** any key (Companies House enrichment is then
recorded as an explicit limitation). To include it, register free at
https://developer.company-information.service.gov.uk/, create a REST API
key, then in the same PowerShell window:

```powershell
$env:COMPANIES_HOUSE_API_KEY = "paste-your-key-here"
```

(That sets it for this window only. To keep it permanently:
`setx COMPANIES_HOUSE_API_KEY "paste-your-key-here"` then open a NEW
PowerShell window.) **Never** paste the key into any file in the
repository.

## 4. Run everything (the one command)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1
```

What you will see: a preflight table (tools, network, readiness), then
numbered stages (probe → capture → lock → score → select → truth slice →
gates → render → verify). A normal full run takes roughly 10–30 minutes
depending on your connection.

## 5. When it finishes

The last lines print the exact profile path — it looks like:

```
outputs\profiles\SUP-<supplier-name>.html
```

Double-click that file to open it in your browser. Every displayed fact
shows a confidence label and evidence chips linking to the on-page
evidence panel.

Then save the results back to GitHub:

```powershell
cd ..\
git add -A
git commit -m "add one-supplier truth slice (local run)"
git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y
```

## If it stops partway

Nothing is lost. It prints the exact resume command; usually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume
```

If it stopped asking you to choose a supplier yourself:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume -Supplier "EXACT NAME FROM THE LIST IT PRINTED"
```

Problems? See `docs\LOCAL_TROUBLESHOOTING.md`.
