#!/usr/bin/env bash
#
# Stop the local ContextPilot SearXNG container.
#
#   ./scripts/searxng-down.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$SCRIPT_DIR/searxng"

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose";
elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose";
else
  echo "Docker/Podman not found; nothing to stop (or remove the container manually: docker rm -f contextpilot-searxng)." >&2
  exit 0
fi

( cd "$DIR" && $COMPOSE down )
echo "SearXNG stopped."
