#!/usr/bin/env bash
# Fails if real family data is tracked by git: GEDCOM files, tree configs, data/, build output or password files.
# Only the fictional demo is allowed. Runs in CI; to run it before every commit as well:
#   ln -s ../../scripts/check_no_family_data.sh .git/hooks/pre-commit
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
bad=$(git ls-files | grep -iE '\.(ged|gedzip)$|\.config\.json$|^data/|^build/|^dist/|\.htpasswd' \
  | grep -vxE 'demo/dummy\.ged|demo/dummy\.config\.json' || true)
if [ -n "$bad" ]; then
  echo "Family data is tracked by git. Remove it (git rm --cached <file>) and keep it in data/:" >&2
  echo "$bad" | sed 's/^/  /' >&2
  exit 1
fi
echo "No family data tracked."
