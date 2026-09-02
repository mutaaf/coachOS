#!/usr/bin/env bash
# Bring the local environment up from cold, or verify it is healthy.
#
# Safe to run at any time: every step checks before acting, so running it while
# everything is already up just confirms that and exits.
#
# Each check below exists because it cost us an afternoon once. The comments say
# which, so nobody re-diagnoses them.

set -uo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ok()   { printf "  ${OK}✓${OFF} %s\n" "$1"; }
info() { printf "  ${DIM}·${OFF} %s\n" "$1"; }
warn() { printf "  ${WARN}!${OFF} %s\n" "$1"; }
die()  { printf "  ${ERR}✗${OFF} %s\n" "$1"; exit 1; }

printf "\n${BOLD}Rising Stars — local environment${OFF}\n\n"

# ---------------------------------------------------------------------------
# 1. Node
#
# supabase-js opens a realtime WebSocket and needs a native one, which arrived
# in Node 22. On Node 20 every integration test fails at client construction
# with "native WebSocket not found" — it broke CI while passing locally.
# ---------------------------------------------------------------------------
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
[ -n "$NODE_MAJOR" ] || die "Node is not installed."
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node $NODE_MAJOR is too old — supabase-js needs a native WebSocket (Node 22+)."
fi
ok "Node $(node -v)"

# ---------------------------------------------------------------------------
# 2. Docker credentials
#
# A leftover Docker Desktop install leaves "credsStore": "desktop" in
# ~/.docker/config.json. Without the docker-credential-desktop binary every
# single pull fails with an obscure credentials error, including Supabase's.
# ---------------------------------------------------------------------------
DOCKER_CFG="$HOME/.docker/config.json"
if [ -f "$DOCKER_CFG" ] && grep -q '"credsStore"' "$DOCKER_CFG"; then
  if ! command -v docker-credential-desktop >/dev/null 2>&1; then
    cp "$DOCKER_CFG" "$DOCKER_CFG.bak-$(date +%s)"
    python3 - "$DOCKER_CFG" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
cfg.pop("credsStore", None)
json.dump(cfg, open(p, "w"), indent=2)
PY
    warn "Removed a stale credsStore from ~/.docker/config.json (it breaks every pull)."
  fi
fi

# ---------------------------------------------------------------------------
# 3. Container runtime
#
# Colima rather than Docker Desktop — no licence, and it runs headless.
# ---------------------------------------------------------------------------
command -v colima >/dev/null 2>&1 || die "Colima is missing. Install it: brew install colima docker"

if ! colima status >/dev/null 2>&1; then
  info "Starting Colima (takes a minute on a cold boot)…"
  colima start --cpu 4 --memory 8 --disk 40 >/dev/null 2>&1 || die "Colima failed to start."
fi
docker info >/dev/null 2>&1 || die "Docker is not responding even though Colima is up."
ok "Docker via Colima"

# ---------------------------------------------------------------------------
# 4. Dependencies
# ---------------------------------------------------------------------------
# npm workspaces hoist to the root, so apps/web/node_modules never exists —
# checking for it made this reinstall on every single run. Probe a package that
# is actually resolvable instead.
if [ ! -d node_modules/next ] && [ ! -d apps/web/node_modules/next ]; then
  info "Installing dependencies…"
  npm install >/dev/null 2>&1 || die "npm install failed."
fi
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 5. Supabase
#
# Two settings in supabase/config.toml are load-bearing and easy to lose:
#   - analytics disabled: that container mounts /var/run/docker.sock, which
#     Colima does not provide, and the whole stack fails to start without it.
#   - `ops` in [api] schemas: PostgREST will not serve the operational tables
#     otherwise, and every query returns "Invalid schema: ops".
# ---------------------------------------------------------------------------
grep -qE '^\s*enabled\s*=\s*false' <(sed -n '/^\[analytics\]/,/^\[/p' supabase/config.toml) \
  || warn "supabase/config.toml has analytics enabled — it will fail to start under Colima."
grep -q '"ops"' supabase/config.toml \
  || warn "supabase/config.toml does not expose the ops schema — queries will fail."

if ! supabase status >/dev/null 2>&1; then
  info "Starting Supabase (first run pulls several GB)…"
  supabase start >/dev/null 2>&1 || die "supabase start failed. Run it directly to see why."
fi

API_URL="$(supabase status -o json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["API_URL"])')"
case "$API_URL" in
  http://127.0.0.1*|http://localhost*) ok "Supabase at $API_URL" ;;
  *) die "Supabase reports $API_URL — refusing to continue against a non-local database." ;;
esac

# ---------------------------------------------------------------------------
# 6. Playwright
# ---------------------------------------------------------------------------
if ! npx playwright install --dry-run chromium >/dev/null 2>&1; then
  info "Installing the Playwright browser…"
  npx playwright install chromium >/dev/null 2>&1
fi
ok "Playwright ready"

printf "\n${BOLD}Ready.${OFF}\n"
printf "  ${DIM}npm test${OFF}          integration tests\n"
printf "  ${DIM}npm run test:e2e${OFF}  end-to-end, including the run-book\n"
printf "  ${DIM}npm run dev:web${OFF}   the app at http://localhost:3050\n"
printf "  ${DIM}npm run down${OFF}      stop everything\n\n"
