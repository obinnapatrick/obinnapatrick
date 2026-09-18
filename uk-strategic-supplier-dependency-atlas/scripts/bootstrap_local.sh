#!/usr/bin/env bash
# UK Strategic Supplier Dependency Atlas - one-command local runner (macOS/Linux)
#
# Usage (from anywhere):
#   bash scripts/bootstrap_local.sh              # full run
#   bash scripts/bootstrap_local.sh --resume     # resume after a stop
#   bash scripts/bootstrap_local.sh --supplier "NAME"
#
# Stdlib-only Python: no virtual environment and no installs required.
# A failure preserves completed work and prints the exact resume command.

set -u
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
export PYTHONUTF8=1

echo "=== UK Strategic Supplier Dependency Atlas - local bootstrap ==="
echo "Repository: $REPO_ROOT"

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
      PY="$candidate"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "ERROR: Python 3.9+ not found. Install it (https://www.python.org/downloads/) and rerun."
  exit 2
fi
echo "Python: $("$PY" --version) (via '$PY')"

if command -v git >/dev/null 2>&1; then
  echo "Git: $(git --version)"
else
  echo "WARNING: git not found - run works, but pulling updates/pushing results needs it."
fi

echo "Dependencies: none required (Python standard library only; no venv needed)."

if [ -z "${COMPANIES_HOUSE_API_KEY:-}" ]; then
  echo "COMPANIES_HOUSE_API_KEY: absent (optional - key-free path continues;"
  echo "  Companies House enrichment recorded as an explicit limitation)."
else
  echo "COMPANIES_HOUSE_API_KEY: present (value not shown)."
fi

"$PY" scripts/preflight_local.py
PREFLIGHT=$?
if [ "$PREFLIGHT" -eq 3 ]; then
  echo ""
  echo "Preflight is BLOCKED - not proceeding to real output."
  echo "See docs/LOCAL_TROUBLESHOOTING.md and data/inbox/README.md (file-drop fallback)."
  exit 3
fi
if [ "$PREFLIGHT" -ne 0 ]; then
  echo "Preflight hit an environment error (see message above)."
  exit 2
fi

RUN_ARGS=(scripts/run_level4.py)
RESUME_HINT="bash scripts/bootstrap_local.sh --resume"
while [ $# -gt 0 ]; do
  case "$1" in
    --resume) RUN_ARGS+=(--resume); shift ;;
    --supplier) RUN_ARGS+=(--supplier "$2"); RESUME_HINT="$RESUME_HINT --supplier \"$2\""; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

"$PY" "${RUN_ARGS[@]}"
RUN_EXIT=$?
if [ "$RUN_EXIT" -ne 0 ]; then
  echo ""
  echo "The run stopped. Completed work is preserved."
  echo "Resume with:"
  echo "  $RESUME_HINT"
  echo "Troubleshooting: docs/LOCAL_TROUBLESHOOTING.md"
  exit "$RUN_EXIT"
fi

echo ""
echo "=== DONE - Level 4 run finished ==="
echo "Open the generated profile from outputs/profiles/ (exact path printed above)."
echo "Then commit and push:"
echo "  git add -A && git commit -m 'add one-supplier truth slice (local run)'"
echo "  git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y"
exit 0
