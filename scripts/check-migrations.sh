#!/usr/bin/env bash
# Migrations are checked before they can reach production, where Ship runs
# them before the new code is live and nothing can undo them.
#
#   BASE=<sha> [LABELS='["destructive-ok"]'] [ORDER_CHECK=0] bash scripts/check-migrations.sh
#
# - Applied migrations are history: never edited, renamed or deleted.
# - New ones are named YYYYMMDDHHMMSS_what_it_does.sql and sort after the
#   newest on main (two agents' migrations must not run out of order).
# - Anything destructive needs the 'destructive-ok' label from a person.
set -euo pipefail

if [ -z "${BASE:-}" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$BASE" 2>/dev/null; then
  echo "No base to compare with; skipping."
  exit 0
fi

changed=$(git diff --name-status "$BASE"...HEAD -- supabase/migrations || true)
[ -n "$changed" ] && echo "$changed"

if echo "$changed" | grep -qE '^(M|D|R)'; then
  echo "::error::Never edit, rename or delete a migration that exists on main — production has already run it. Add a new one."
  exit 1
fi

latest=$(git ls-tree --name-only "$BASE" supabase/migrations/ | sed 's#.*/##' | sort | tail -1)
status=0
for f in $(echo "$changed" | awk '$1=="A"{print $2}'); do
  name=$(basename "$f")
  if [[ ! "$name" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "::error file=$f::Name it YYYYMMDDHHMMSS_what_it_does.sql"
    status=1
  fi
  # Order is checked on pull requests. Once merged, two PRs that each sorted
  # last when they were checked can land in either order; Ship applies them
  # with --include-all, so it passes ORDER_CHECK=0.
  if [[ "${ORDER_CHECK:-1}" = 1 && ! "$name" > "$latest" ]]; then
    echo "::error file=$f::Must sort after $latest, the newest on main. Rename it with a later timestamp."
    status=1
  fi
  # Comments don't count.
  if sed 's/--.*$//' "$f" | grep -inE '\b(drop[[:space:]]+(table|column|schema|function|type|view)|truncate|delete[[:space:]]+from|alter[[:space:]]+column[[:space:]]+[^[:space:]]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type|rename[[:space:]]+(column|to))\b'; then
    if [[ "${LABELS:-}" != *destructive-ok* ]]; then
      echo "::error file=$f::Destructive. Make it additive (expand now, contract in a later release), or have a person add the 'destructive-ok' label."
      status=1
    else
      echo "::warning file=$f::Destructive, approved with destructive-ok."
    fi
  fi
done
exit $status
