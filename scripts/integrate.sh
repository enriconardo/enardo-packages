#!/usr/bin/env bash
set -euo pipefail

# Integrates the current branch into main (root CLAUDE.md, Workflow, step 7),
# after checkpoint 2: refuses a branch name too long for its merge subject, a
# dirty tree, a spec that is not done and a merge that would conflict, runs
# `pnpm verify`, merges with --no-ff and deletes the branch. Runs on the
# host, where git and its hooks run; verify goes to the dev container.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

branch="$(git branch --show-current)"
if [[ -z "$branch" || "$branch" == main ]]; then
  echo "On '${branch:-a detached HEAD}': run this from the branch to integrate." >&2
  exit 1
fi

# The merge's default subject, `Merge branch '<branch>'`, adds 15 characters,
# and the commit-msg hook refuses a subject over 72: the merge would stop
# halfway, with main mid-merge. Checked here too for a branch made by hand.
if ((${#branch} > 57)); then
  echo "'$branch' has ${#branch} characters, over 57: the subject of its merge would be over the 72 that commit-msg allows. Rename the branch first." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has uncommitted changes: commit them before integrating." >&2
  exit 1
fi

# The status of a spec is in its front matter, between the first two `---`.
front_matter() {
  awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' "$1"
}

if ! git rev-parse --verify --quiet main >/dev/null; then
  echo "No local main branch to integrate into." >&2
  exit 1
fi

# The specs this branch adds; an S task has none. Listed in an assignment,
# so that a failing git diff stops the script instead of skipping the check.
specs="$(git diff --name-only --diff-filter=A main...HEAD -- 'docs/specs/*.md')"
while IFS= read -r spec; do
  [[ -n "$spec" ]] || continue
  if ! front_matter "$spec" | grep -qx 'status: done'; then
    echo "$spec is not 'status: done': set it in a commit before integrating." >&2
    exit 1
  fi
done <<<"$specs"

# A conflict would stop the merge halfway, with main mid-merge. merge-tree
# (git 2.38 or later) merges in the object store only: no ref, index or
# working tree changes.
if ! git merge-tree --write-tree main HEAD >/dev/null; then
  echo "Merging '$branch' into main would conflict: merge main into the branch first." >&2
  exit 1
fi

if [[ -f /.dockerenv ]]; then
  pnpm verify
else
  ./dev.sh exec pnpm verify
fi

git switch main
git merge --no-ff --no-edit "$branch"
git branch -d "$branch"
