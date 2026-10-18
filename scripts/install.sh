#!/usr/bin/env bash
#
# ContextPilot turnkey installer — clone the repo, run this, done.
#
#   ./scripts/install.sh            # EVERYTHING: Node (if missing) + pnpm + deps
#                                   # + build + register MCP/hooks/research in ~/.claude
#
# Opt-outs (the default does all of the below):
#   --no-setup          skip registering the MCP server + hooks in ~/.claude
#   --no-research       register setup WITHOUT the research advisory
#   --no-node-install   do not auto-install Node; just fail if Node < 20 is missing
#   --test              also run the test suite after building
#   -h | --help         show this help
#
# What it installs for you: Node >= 20 (via nvm, user-space, only if missing or
# too old), pnpm 10.12.1 (via corepack, npm-global fallback), all workspace
# dependencies, and the native better-sqlite3 addon (built during install).
# It does NOT install Caveman (an optional, separate integration) or `gh`
# (optional; the GitHub provider falls back to the public API without it).
#
# Setup writes to ~/.claude.json and ~/.claude/settings.local.json — that is how
# Claude Code discovers the tool, and is why it runs by default here. Use
# --no-setup to skip it. Safe to re-run: every step is idempotent.

set -euo pipefail

DO_SETUP=1
DO_RESEARCH=1
DO_TEST=0
DO_NODE_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-setup)        DO_SETUP=0 ;;
    --no-research)     DO_RESEARCH=0 ;;
    --no-node-install) DO_NODE_INSTALL=0 ;;
    --test)            DO_TEST=1 ;;
    -h|--help)
      awk 'NR>1{ if ($0 ~ /^#/) { sub(/^# ?/, ""); print } else exit }' "$0"
      exit 0 ;;
    *)
      echo "Unknown option: $arg (see --help)" >&2
      exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# 1. Node >= 20 — auto-install via nvm (user-space, no sudo) when missing/old.
say "Checking Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
  if [ "$DO_NODE_INSTALL" -eq 0 ]; then
    die "Node >= 20 required (found: $(command -v node >/dev/null 2>&1 && node -v || echo none)). Install it and re-run."
  fi
  say "Installing Node >= 20 via nvm (user-space)"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    command -v curl >/dev/null 2>&1 || die "curl is required to install nvm. Install curl, or install Node >= 20 yourself, then re-run."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  [ "$(node_major)" -ge 20 ] || die "Node install did not yield >= 20 (found $(node -v))."
fi
echo "Node $(node -v) OK"

# 2. pnpm via corepack (pinned to the repo's packageManager), npm-global fallback.
say "Ensuring pnpm"
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.12.1 --activate >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "corepack unavailable; installing pnpm globally via npm"
  npm install -g pnpm@10.12.1 || die "Could not install pnpm. See https://pnpm.io/installation"
fi
echo "pnpm $(pnpm --version) OK"

# 3. Dependencies (builds the native better-sqlite3 addon). The config flag
#    avoids an interactive purge prompt that would hang a non-interactive run.
say "Installing dependencies"
pnpm install --config.confirm-modules-purge=false

# 4. Build core, cli, mcp.
say "Building packages"
pnpm -r build

# 5. Optional test run.
if [ "$DO_TEST" -eq 1 ]; then
  say "Running tests"
  pnpm test
fi

# 6. Register globally in ~/.claude (default; --no-setup to skip).
if [ "$DO_SETUP" -eq 1 ]; then
  if [ "$DO_RESEARCH" -eq 1 ]; then
    say "Registering ContextPilot (MCP + hooks + research advisory) in ~/.claude"
    node packages/cli/dist/index.js setup --research
  else
    say "Registering ContextPilot (MCP + hooks) in ~/.claude"
    node packages/cli/dist/index.js setup
  fi
  echo "Restart Claude Code for the changes to take effect."
fi

say "Done"
echo "Verify:    node packages/cli/dist/index.js doctor"
echo "Dashboard: node packages/cli/dist/index.js dashboard"
