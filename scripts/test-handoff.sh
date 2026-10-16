#!/usr/bin/env bash
set -euo pipefail

# Records the test-author's suite as it hands it over (root CLAUDE.md,
# Testing), so that the reviewer sees how the tests changed afterwards: the
# main agent commits them together with the implementation, and the branch's
# diff alone hides an assertion loosened on the way to green. Runs on the
# host, where git runs.
#
#   record          the test-author, last: the changes under __tests__/
#                   against HEAD, as refs/test-author/<branch>/<n>
#   diff            the reviewer: how each recorded suite differs from HEAD
#   clear <branch>  integrate.sh: removes the branch's records
#
# A record is a commit outside refs/heads, so that a red suite never lands
# on the branch, built through a temporary index, so that the working tree,
# the index and the branch stay as they are.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  echo "Usage: scripts/test-handoff.sh record | diff | clear <branch>" >&2
  exit 2
}

# for-each-ref matches a pattern up to a slash: the records of
# chore/repo/x are not those of chore/repo/x-other.
records_of() {
  git for-each-ref --format='%(refname)' "refs/test-author/$1" | sort -V
}

task_branch() {
  local branch
  branch="$(git branch --show-current)"
  if [[ -z "$branch" || "$branch" == main ]]; then
    echo "On '${branch:-a detached HEAD}': a suite is recorded on its task's branch." >&2
    exit 1
  fi
  printf '%s' "$branch"
}

record() {
  local branch reference tree count ref commit
  branch="$(task_branch)"

  reference="$(git ls-files --others --exclude-standard -- ':(glob)**/__tests__/.reference/**')"
  if [[ -n "$reference" ]]; then
    printf 'A reference model is still in place: delete it first.\n%s\n' "$reference" >&2
    exit 1
  fi

  # Global: the trap runs after record returns, when a local is gone.
  index="$(mktemp)"
  trap 'rm -f "$index"' EXIT
  GIT_INDEX_FILE="$index" git read-tree HEAD
  GIT_INDEX_FILE="$index" git add -A -- ':(glob)**/__tests__/**'
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  if [[ "$tree" == "$(git rev-parse 'HEAD^{tree}')" ]]; then
    echo "No change under __tests__/ against HEAD: nothing to record." >&2
    exit 1
  fi

  count="$(records_of "$branch" | wc -l)"
  ref="refs/test-author/$branch/$((count + 1))"
  commit="$(git commit-tree "$tree" -p HEAD -m "test-author suite on $branch")"
  git update-ref "$ref" "$commit"
  echo "Recorded as $ref:"
  git diff --name-status HEAD "$commit"
}

diff_records() {
  local branch ref
  local -a refs files
  branch="$(task_branch)"
  mapfile -t refs < <(records_of "$branch")
  if ((${#refs[@]} == 0)); then
    echo "No suite recorded on $branch."
    return
  fi
  for ref in "${refs[@]}"; do
    mapfile -t files < <(git diff --name-only "$ref^" "$ref")
    echo "== Suite ${ref##*/}, written on $(git log -1 --format='%h %s' "$ref^")"
    if git diff --quiet "$ref" HEAD -- "${files[@]}"; then
      echo "Unchanged in HEAD."
    else
      git --no-pager diff "$ref" HEAD -- "${files[@]}"
    fi
  done
}

clear_records() {
  local ref
  records_of "$1" | while IFS= read -r ref; do
    git update-ref -d "$ref"
  done
}

case "${1:-}" in
  record) (($# == 1)) || usage; record ;;
  diff) (($# == 1)) || usage; diff_records ;;
  clear)
    # An empty name would match the records of every branch.
    if (($# != 2)) || [[ -z "$2" ]]; then usage; fi
    clear_records "$2"
    ;;
  *) usage ;;
esac
