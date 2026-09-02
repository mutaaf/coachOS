#!/usr/bin/env bash
# Stop everything this project runs locally, freeing the RAM the VM holds.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Stopping Supabase…"
supabase stop >/dev/null 2>&1 || true

# `supabase stop` only knows about this project's stack. A second stack started
# from another directory — or orphaned by a `start` over a half-dead one —
# survives it and quietly holds gigabytes. Twenty containers were once left
# running this way, and the VM stayed up because something was still in it.
ORPHANS="$(docker ps -q --filter "name=supabase_" 2>/dev/null)"
if [ -n "$ORPHANS" ]; then
  echo "Stopping $(echo "$ORPHANS" | wc -l | tr -d ' ') orphaned Supabase container(s)…"
  echo "$ORPHANS" | xargs -r docker stop >/dev/null 2>&1 || true
  docker ps -aq --filter "name=supabase_" 2>/dev/null | xargs -r docker rm >/dev/null 2>&1 || true
fi

REMAINING="$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
if [ "$REMAINING" = "0" ]; then
  echo "Stopping Colima…"
  colima stop >/dev/null 2>&1 || true
else
  echo "Leaving Colima up — $REMAINING container(s) not ours are still running."
fi

echo "Done. 'npm run up' brings it all back."
