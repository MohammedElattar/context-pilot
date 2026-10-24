#!/usr/bin/env bash
#
# ContextPilot + Caveman — full-stack turnkey installer.
#
#   ./scripts/install.sh            # EVERYTHING: Node, pnpm, Caveman, gh, Docker,
#                                   # SearXNG, deps, build, register MCP/hooks/research
#
# Options:
#   --strict            enable strict routing (deny native WebFetch/WebSearch)
#   --no-searxng        skip starting local SearXNG
#   --no-setup          skip registering MCP server + hooks in ~/.claude
#   --no-research       register setup WITHOUT the research advisory/skill
#   --no-node-install   do not auto-install Node; fail if Node < 20 is missing
#   --no-caveman        skip Caveman install/upgrade
#   --no-docker         skip Docker check and SearXNG
#   --no-gh             skip GitHub CLI (gh) install
#   --test              run the test suite after building
#   -h | --help         show this help
#
# What gets installed (all idempotent, safe to re-run):
#   1. Node >= 20          via nvm (user-space, no sudo)
#   2. pnpm 10.12.1        via corepack or npm
#   3. Caveman 4.x         via npm -g @caveman-ai/cli (token optimization proxy)
#   4. GitHub CLI (gh)      for contextpilot_research GitHub provider
#   5. Docker (guidance)    needed for free local SearXNG search
#   6. ContextPilot deps    pnpm install + build all packages
#   7. SearXNG              free private local web search (Docker)
#   8. Setup                register MCP server, hooks, research skill in ~/.claude

set -euo pipefail

DO_SETUP=1
DO_RESEARCH=1
DO_STRICT=0
DO_SEARXNG=1
DO_TEST=0
DO_NODE_INSTALL=1
DO_CAVEMAN=1
DO_DOCKER=1
DO_GH=1
for arg in "$@"; do
  case "$arg" in
    --no-setup)        DO_SETUP=0 ;;
    --no-research)     DO_RESEARCH=0 ;;
    --strict)          DO_STRICT=1 ;;
    --no-searxng)      DO_SEARXNG=0 ;;
    --no-node-install) DO_NODE_INSTALL=0 ;;
    --no-caveman)      DO_CAVEMAN=0 ;;
    --no-docker)       DO_DOCKER=0; DO_SEARXNG=0 ;;
    --no-gh)           DO_GH=0 ;;
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

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$1"; }
die()  { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

SHELL_PROFILE=""
detect_profile() {
  case "${SHELL:-}" in *zsh) SHELL_PROFILE="$HOME/.zshrc" ;; *) SHELL_PROFILE="$HOME/.bashrc" ;; esac
}
detect_profile

append_to_profile() {
  local marker="$1" line="$2"
  if [ -f "$SHELL_PROFILE" ] && grep -qF "$marker" "$SHELL_PROFILE"; then
    return 0
  fi
  printf '\n%s\n' "$line" >> "$SHELL_PROFILE"
}

# ─── 1. Node >= 20 ───────────────────────────────────────────────────────────
say "1/8  Node.js"
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 20 ]; then
  ok "Node $(node -v) found"
else
  if [ "$DO_NODE_INSTALL" -eq 0 ]; then
    die "Node >= 20 required (found: $(command -v node >/dev/null 2>&1 && node -v || echo none)). Install it and re-run."
  fi
  say "Installing Node >= 20 via nvm (user-space, no sudo)"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    command -v curl >/dev/null 2>&1 || die "curl is required to install nvm. Install curl first."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  [ "$(node_major)" -ge 20 ] || die "Node install did not yield >= 20 (found $(node -v))."
  ok "Node $(node -v) installed"
fi

# ─── 2. pnpm ─────────────────────────────────────────────────────────────────
say "2/8  pnpm"
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version) found"
else
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.12.1 --activate >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "  Installing pnpm globally via npm"
    npm install -g pnpm@10.12.1 || die "Could not install pnpm. See https://pnpm.io/installation"
  fi
  ok "pnpm $(pnpm --version) installed"
fi

# ─── 3. Caveman ──────────────────────────────────────────────────────────────
say "3/8  Caveman (token optimization proxy)"
if [ "$DO_CAVEMAN" -eq 1 ]; then
  CAVEMAN_INSTALLED=0
  if command -v caveman >/dev/null 2>&1; then
    CAVEMAN_VER=$(caveman --version 2>/dev/null | grep -oP '"version":\s*"\K[^"]+' || echo "unknown")
    ok "Caveman $CAVEMAN_VER found"
    CAVEMAN_INSTALLED=1
  fi
  if [ "$CAVEMAN_INSTALLED" -eq 0 ]; then
    echo "  Installing Caveman via npm -g @caveman-ai/cli"
    npm install -g @caveman-ai/cli || {
      warn "Caveman install failed. Install manually: npm install -g @caveman-ai/cli"
      warn "Then run: caveman claude"
    }
    if command -v caveman >/dev/null 2>&1; then
      ok "Caveman installed"
    fi
  fi
  # Ensure Caveman proxy is configured for Claude
  if command -v caveman >/dev/null 2>&1; then
    if [ ! -d "$HOME/.caveman/run" ] || [ -z "$(ls "$HOME/.caveman/run/" 2>/dev/null)" ]; then
      warn "Caveman proxy not running. Start it with: caveman claude"
      warn "This sets ANTHROPIC_BASE_URL=http://127.0.0.1:8787/w/claude for compression"
    else
      ok "Caveman proxy running"
    fi
    # Check if Caveman login is done
    if [ ! -d "$HOME/.caveman/credentials" ] || [ -z "$(ls "$HOME/.caveman/credentials/" 2>/dev/null)" ]; then
      warn "Caveman not logged in. Run: caveman login (free account, enables learn/cloud features)"
    fi
  fi
else
  warn "Skipped (--no-caveman)"
fi

# ─── 4. GitHub CLI (gh) ──────────────────────────────────────────────────────
say "4/8  GitHub CLI (gh)"
if [ "$DO_GH" -eq 1 ]; then
  if command -v gh >/dev/null 2>&1; then
    ok "gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}') found"
  else
    echo "  Installing GitHub CLI"
    if command -v apt-get >/dev/null 2>&1; then
      # Debian/Ubuntu
      (type -p wget >/dev/null || sudo apt-get install -y wget) \
        && sudo mkdir -p -m 755 /etc/apt/keyrings \
        && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
        && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
        && sudo apt-get update -qq \
        && sudo apt-get install -y gh
    elif command -v brew >/dev/null 2>&1; then
      brew install gh
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y gh
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -S --noconfirm github-cli
    else
      warn "Could not auto-install gh. Install manually: https://cli.github.com"
      warn "gh is needed for contextpilot_research GitHub issue/PR support"
    fi
    if command -v gh >/dev/null 2>&1; then
      ok "gh installed"
      # Check auth
      if ! gh auth status >/dev/null 2>&1; then
        warn "gh not authenticated. Run: gh auth login"
      fi
    fi
  fi
else
  warn "Skipped (--no-gh)"
fi

# ─── 5. Docker ───────────────────────────────────────────────────────────────
say "5/8  Docker (for local SearXNG search)"
HAS_DOCKER=0
if [ "$DO_DOCKER" -eq 1 ]; then
  if docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1 || podman compose version >/dev/null 2>&1; then
    ok "Docker/Podman found"
    HAS_DOCKER=1
  else
    if command -v docker >/dev/null 2>&1; then
      warn "Docker found but 'docker compose' not available. Install Docker Compose plugin."
      warn "See: https://docs.docker.com/compose/install/"
    else
      warn "Docker not found — needed for free local SearXNG web search."
      warn "Install Docker: https://docs.docker.com/engine/install/"
      warn "Or on WSL: https://docs.docker.com/desktop/wsl/"
      warn "Without Docker, contextpilot_search falls back to BRAVE_API_KEY or native WebSearch."
    fi
  fi
else
  warn "Skipped (--no-docker)"
fi

# ─── 6. ContextPilot deps + build ────────────────────────────────────────────
say "6/8  ContextPilot dependencies"
pnpm install --config.confirm-modules-purge=false
ok "Dependencies installed"

say "      Building packages"
pnpm -r build
ok "Build complete"

if [ "$DO_TEST" -eq 1 ]; then
  say "      Running tests"
  pnpm test
  ok "Tests passed"
fi

# ─── 7. SearXNG ──────────────────────────────────────────────────────────────
say "7/8  SearXNG (free local web search)"
if [ "$DO_SEARXNG" -eq 1 ] && [ "$HAS_DOCKER" -eq 1 ]; then
  if "$SCRIPT_DIR/searxng-up.sh"; then
    SEARXNG_PORT="${SEARXNG_PORT:-8888}"
    export CONTEXTPILOT_SEARXNG_URL="http://127.0.0.1:$SEARXNG_PORT"
    append_to_profile "CONTEXTPILOT_SEARXNG_URL" \
      "# ContextPilot — local SearXNG for free private web search
export CONTEXTPILOT_SEARXNG_URL=http://127.0.0.1:$SEARXNG_PORT"
    ok "SearXNG running at http://127.0.0.1:$SEARXNG_PORT"
  else
    warn "SearXNG did not start. Retry later: ./scripts/searxng-up.sh"
  fi
elif [ "$DO_SEARXNG" -eq 1 ]; then
  warn "Skipped — Docker not available (install Docker, then re-run or ./scripts/searxng-up.sh)"
else
  warn "Skipped (--no-searxng)"
fi

# ─── 8. Register in ~/.claude ─────────────────────────────────────────────────
say "8/8  Register ContextPilot in ~/.claude"
if [ "$DO_SETUP" -eq 1 ]; then
  args=()
  [ "$DO_RESEARCH" -eq 1 ] && args+=(--research)
  [ "$DO_STRICT" -eq 1 ]   && args+=(--strict)
  if [ "${#args[@]}" -gt 0 ]; then
    node packages/cli/dist/index.js setup "${args[@]}"
  else
    node packages/cli/dist/index.js setup
  fi
  ok "MCP server, hooks, and research skill registered"
else
  warn "Skipped (--no-setup)"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
say "Installation complete!"
echo ""
printf '  \033[1m%-20s\033[0m %s\n' "Node" "$(node -v)"
printf '  \033[1m%-20s\033[0m %s\n' "pnpm" "$(pnpm --version)"
if command -v caveman >/dev/null 2>&1; then
  printf '  \033[1m%-20s\033[0m %s\n' "Caveman" "$(caveman --version 2>/dev/null | grep -oP '"version":\s*"\K[^"]+' || echo 'installed')"
fi
if command -v gh >/dev/null 2>&1; then
  printf '  \033[1m%-20s\033[0m %s\n' "GitHub CLI" "$(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
fi
printf '  \033[1m%-20s\033[0m %s\n' "Docker" "$(docker --version 2>/dev/null | head -1 || echo 'not installed')"
echo ""
echo "  Next steps:"
if command -v caveman >/dev/null 2>&1; then
  if [ ! -d "$HOME/.caveman/run" ] || [ -z "$(ls "$HOME/.caveman/run/" 2>/dev/null)" ]; then
    echo "    caveman claude             # start the optimization proxy"
  fi
fi
echo "    contextpilot doctor          # verify everything works"
echo "    contextpilot dashboard       # open the web dashboard"
echo ""
echo "  Restart Claude Code for changes to take effect."
