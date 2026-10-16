#!/usr/bin/env bash
set -euo pipefail

# Starts a task (root CLAUDE.md, Workflow, step 1): checks the branch name
# against *Branches and commits*, then creates the branch from an up-to-date
# main. Runs on the host, where git and its hooks run.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if (($# != 1)); then
  echo "Usage: scripts/task-start.sh <type>/<scope>/<description>" >&2
  exit 2
fi
branch="$1"

types='feature|fix|hotfix|refactor|test|docs|chore'
kebab='[a-z0-9]+(-[a-z0-9]+)*'
# The description may start with a ticket id: fix/uow-repository/EN-209-snapshot-diff.
pattern="^($types)/$kebab/([A-Z]+-[0-9]+-)?$kebab\$"
if ! [[ "$branch" =~ $pattern ]]; then
  echo "'$branch' is not <type>/<scope>/<description>: a type among ${types//|/, }, then a kebab-case scope and description." >&2
  exit 1
fi

current="$(git branch --show-current)"
if [[ "$current" != main ]]; then
  echo "On '${current:-a detached HEAD}': a task starts from main." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has uncommitted changes: a task starts from a clean main." >&2
  exit 1
fi

# This clone may have no remote; main is up to date when it has none.
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  git pull --ff-only
fi

git switch -c "$branch"
