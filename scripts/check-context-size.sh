#!/usr/bin/env bash
set -euo pipefail

# Keeps the files that every session loads within a budget (root CLAUDE.md,
# Workflow, step 6): the root CLAUDE.md, which every session and subagent
# reads, and each agent definition. A new rule merges with an old one or
# replaces it, instead of growing them. `pnpm verify` runs this outside
# turbo, on every call.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ROOT_BUDGET=12000
AGENT_BUDGET=6000

failed=0

check() {
  local file="$1" budget="$2" size
  size="$(wc -c <"$file")"
  if ((size > budget)); then
    echo "${file#"$ROOT_DIR"/} is $size bytes, over its budget of $budget: merge or replace rules instead of adding them." >&2
    failed=1
  fi
}

check "$ROOT_DIR/CLAUDE.md" "$ROOT_BUDGET"

shopt -s nullglob
for agent in "$ROOT_DIR"/.claude/agents/*.md; do
  check "$agent" "$AGENT_BUDGET"
done

exit "$failed"
