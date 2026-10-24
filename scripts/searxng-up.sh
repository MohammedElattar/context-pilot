#!/usr/bin/env bash
#
# Start a local SearXNG for the ContextPilot research gateway (free, private,
# no API key). Requires Docker (or Podman). Idempotent.
#
#   ./scripts/searxng-up.sh
#
# On success it prints the CONTEXTPILOT_SEARXNG_URL to export. `contextpilot
# setup` and contextpilot_search pick that env var up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$SCRIPT_DIR/searxng"
# Default port; override with SEARXNG_PORT env var if 8080 is taken (e.g. by Burp).
SEARXNG_PORT="${SEARXNG_PORT:-8888}"
URL="http://127.0.0.1:$SEARXNG_PORT"

die() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

# Compose command: prefer `docker compose`, then `docker-compose`, then podman.
# Each candidate is tested with `version` to catch broken symlinks (e.g. Docker
# Desktop not running on WSL where the binary points to /mnt/wsl/...).
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose";
elif docker-compose version >/dev/null 2>&1; then COMPOSE="docker-compose";
elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose";
else
  die "Docker (or Podman) is required. Install Docker Desktop / Docker Engine (https://docs.docker.com/get-docker/), then re-run. Manual fallback:
  docker run -d --name contextpilot-searxng -p 127.0.0.1:$SEARXNG_PORT:8080 -v \"$DIR/settings.yml:/etc/searxng/settings.yml\" searxng/searxng:latest"
fi

# Create the runtime config (gitignored) from the committed template on first run.
if [ ! -f "$DIR/settings.yml" ]; then
  cp "$DIR/settings.example.yml" "$DIR/settings.yml"
fi
# Generate the secret into the secret_key line only (node is always present).
if grep -q '__SEARXNG_SECRET__' "$DIR/settings.yml"; then
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  # Temp file to stay portable across BSD/GNU sed.
  sed "s|secret_key: \"__SEARXNG_SECRET__\"|secret_key: \"$SECRET\"|" "$DIR/settings.yml" > "$DIR/settings.yml.tmp" && mv "$DIR/settings.yml.tmp" "$DIR/settings.yml"
  echo "Generated SearXNG secret_key."
fi

echo "Starting SearXNG on port $SEARXNG_PORT ..."
export SEARXNG_PORT
( cd "$DIR" && $COMPOSE up -d )

echo "Waiting for the JSON API ..."
for i in $(seq 1 30); do
  if curl -fsS "$URL/search?q=test&format=json" >/dev/null 2>&1; then
    echo
    echo "SearXNG is up. Enable it for ContextPilot:"
    echo
    echo "  export CONTEXTPILOT_SEARXNG_URL=$URL"
    echo
    echo "Add that line to your shell profile (~/.zshrc or ~/.bashrc) to persist it,"
    echo "then contextpilot_search uses it automatically. Stop it with ./scripts/searxng-down.sh"
    exit 0
  fi
  sleep 1
done

die "SearXNG did not answer the JSON API at $URL within 30s. Check logs: ( cd \"$DIR\" && $COMPOSE logs )"
