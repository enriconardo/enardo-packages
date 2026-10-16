#!/usr/bin/env bash
set -euo pipefail

# The Stop hook (.claude/settings.json): runs `pnpm verify` at the end of
# each turn, and blocks finishing on a red state, with exit 2 and the tail of
# its output on stderr. A clean tree at main's commit has nothing to verify:
# integrate.sh merges only after a green verify. Skipping it keeps a turn
# that changed nothing, a question's, from failing on a stopped container.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Set when the turn goes on because this hook blocked it: blocking again
# would loop.
input="$(cat)"
if [[ "$input" =~ \"stop_hook_active\"[[:space:]]*:[[:space:]]*true ]]; then
  exit 0
fi

# Each value is checked before the comparison: outside a repository, or
# without a main, both sides would be empty and equal.
if status="$(git status --porcelain)" && [[ -z "$status" ]] &&
  head="$(git rev-parse --verify --quiet HEAD)" &&
  main="$(git rev-parse --verify --quiet main)" &&
  [[ "$head" == "$main" ]]; then
  exit 0
fi

if [[ -f /.dockerenv ]]; then
  verify=(pnpm verify)
else
  verify=(./dev.sh exec pnpm verify)
fi

if ! out="$("${verify[@]}" 2>&1)"; then
  printf '%s\n' "$out" | tail -40 >&2
  echo 'verify failed: fix the checks above before finishing.' >&2
  exit 2
fi
