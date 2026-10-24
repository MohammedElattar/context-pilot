#!/usr/bin/env bash
#
# Stop the local ContextPilot SearXNG container.
#
#   ./scripts/searxng-down.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$SCRIPT_DIR/searxng"
CONTAINER_NAME="contextpilot-searxng"

if docker compose version >/dev/null 2>&1; then
  ( cd "$DIR" && docker compose down )
elif docker-compose version >/dev/null 2>&1; then
  ( cd "$DIR" && docker-compose down )
elif podman compose version >/dev/null 2>&1; then
  ( cd "$DIR" && podman compose down )
elif docker version >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
elif podman version >/dev/null 2>&1; then
  podman rm -f "$CONTAINER_NAME" 2>/dev/null || true
else
  echo "Docker/Podman not found; nothing to stop." >&2
  exit 0
fi
echo "SearXNG stopped."
