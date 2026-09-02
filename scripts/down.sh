#!/usr/bin/env bash
# Stop everything this project runs locally, freeing the RAM the VM holds.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Stopping Supabase…"
supabase stop >/dev/null 2>&1 || true

# Only stop the VM if nothing else is using it.
if [ "$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
  echo "Stopping Colima…"
  colima stop >/dev/null 2>&1 || true
else
  echo "Leaving Colima up — other containers are still running."
fi

echo "Done. 'npm run up' brings it all back."
