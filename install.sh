#!/usr/bin/env bash
# One-click installer: turn OpenCode into a super-app (macOS / Linux / WSL).
# Usage:
#   ./install.sh                          # interactive menu: superapp first, then stacks
#   ./install.sh --superapp               # zero-API-key essentials (recommended start)
#   ./install.sh --stack web-dev          # install a whole stack into ./opencode.json
#   ./install.sh --add github sentry      # install individual servers
#   ./install.sh --add github --global    # install into ~/.config/opencode/opencode.json
#   ./install.sh --list                   # list every server
#   ./install.sh --search postgres        # searchable index
#   ./install.sh --validate               # check the kit's own files
#   ./install.sh --help
# --global, --config PATH, --force and --dry-run are passed on to the CLI. They also work
# with the menu:  ./install.sh --global
set -euo pipefail

# With CDPATH set, `cd` can jump to a same-named directory elsewhere and print its path.
KIT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MANAGER="$KIT_DIR/scripts/mcp-manager.mjs"

usage() {
  cat <<'EOF'
Usage: ./install.sh [COMMAND] [--global | --config PATH] [--force] [--dry-run]

  (no command)       interactive menu
  --superapp         install the zero-API-key essentials
  --stack NAME       install a stack: superapp, web-dev, data-analysis, devops,
                     ai-search, productivity, testing
  --add ID...        install individual servers
  --list             list every server (also: --list --stack NAME, --list --json)
  --search QUERY     search the registry
  --validate         check the kit's own files
  --help             show this help

Servers already in your config are kept as they are; --force replaces them.
EOF
}

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node >=18 is required (https://nodejs.org). Install it, then re-run." >&2
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -lt 18 ]]; then
    echo "error: node >=18 is required, found $(node --version). Upgrade it, then re-run." >&2
    exit 1
  fi
}

menu() {
  echo "OpenCode super-app installer - pick one:"
  echo "  0) superapp      (8 zero-key essentials - start here)"
  echo "  1) web-dev       (files, git, browser, hosting, UI)"
  echo "  2) data-analysis (SQL/NoSQL + reasoning memory)"
  echo "  3) devops        (containers, IaC, clouds, observability)"
  echo "  4) ai-search     (web search, scrape, docs grounding)"
  echo "  5) productivity  (tickets, docs, chat)"
  echo "  6) testing       (browsers, perf, reference harness)"
  local choice stack
  if ! read -rp "Choice [0-6]: " choice; then
    echo >&2
    echo "error: no input for the menu. Name a stack instead, e.g. ./install.sh --superapp" >&2
    exit 1
  fi
  case "$choice" in
    0|"") stack=superapp ;;
    1) stack=web-dev ;;
    2) stack=data-analysis ;;
    3) stack=devops ;;
    4) stack=ai-search ;;
    5) stack=productivity ;;
    6) stack=testing ;;
    *) echo "cancelled"; exit 0 ;;
  esac
  exec node "$MANAGER" stack "$stack" "$@"
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

need_node

case "${1:-}" in
  ""|--global|--config|--config=*|--force|--dry-run) menu "$@" ;;
  --superapp) shift; exec node "$MANAGER" stack superapp "$@" ;;
  --list) shift; exec node "$MANAGER" list "$@" ;;
  --search) shift; exec node "$MANAGER" search "$@" ;;
  --stack) shift; exec node "$MANAGER" stack "$@" ;;
  --add) shift; exec node "$MANAGER" add "$@" ;;
  --validate) exec node "$KIT_DIR/scripts/validate.mjs" ;;
  *)
    echo "error: unknown option '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
