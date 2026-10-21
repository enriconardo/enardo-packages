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
#   changes         the checkpoint 2 report: each recorded suite's files
#                   that differ in HEAD, with the commits that changed them
#   clear <branch>  integrate.sh: removes the branch's records
#
# A record is a commit outside refs/heads, so that a red suite never lands
# on the branch, built through a temporary index, so that the working tree,
# the index and the branch stay as they are.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  echo "Usage: scripts/test-handoff.sh record | diff | changes | clear <branch>" >&2
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
  local branch reference tree last next ref commit
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

  # The highest number plus one, not the count, which a record removed by
  # hand would turn into an existing one; the empty old value refuses it.
  last="$(records_of "$branch" | tail -n 1)"
  next=1
  if [[ -n "$last" ]]; then
    next=$((${last##*/} + 1))
  fi
  ref="refs/test-author/$branch/$next"
  commit="$(git commit-tree "$tree" -p HEAD -m "test-author suite on $branch")"
  git update-ref "$ref" "$commit" ""
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

# A commit that leaves a file as this suite or a later one wrote it changed
# nothing of this suite's: the one that lands a suite with its
# implementation, or a later suite that adds cases to its file. An earlier
# suite does not count: back to its version, the file lost a later suite's
# cases. Nor does a record that left the file alone: each record holds the
# whole tree, with the other suites' files as committed when it was taken.
as_recorded() {
  local file="$1" commit="$2" from="$3" ref
  for ref in "${refs[@]:from}"; do
    if ! git diff --quiet "$ref^" "$ref" -- "$file" &&
      git diff --quiet "$ref" "$commit" -- "$file"; then
      return 0
    fi
  done
  return 1
}

list_changes() {
  local branch ref file commit unchanged i
  local -a refs files changed commits listed
  branch="$(task_branch)"
  mapfile -t refs < <(records_of "$branch")
  if ((${#refs[@]} == 0)); then
    echo "No suite recorded on $branch."
    return
  fi
  for i in "${!refs[@]}"; do
    ref="${refs[i]}"
    mapfile -t files < <(git diff --name-only "$ref^" "$ref")
    echo "== Suite ${ref##*/}, written on $(git log -1 --format='%h %s' "$ref^")"
    mapfile -t changed < <(git diff --name-only "$ref" HEAD -- "${files[@]}")
    unchanged=1
    for file in "${changed[@]}"; do
      mapfile -t commits < <(git log --format=%H "$ref^..HEAD" -- "$file")
      # Changed, and no commit touched it: thrown away before any commit.
      if ((${#commits[@]} == 0)); then
        unchanged=0
        echo "$file"
        echo "  not committed as recorded"
        continue
      fi
      listed=()
      for commit in "${commits[@]}"; do
        as_recorded "$file" "$commit" "$i" || listed+=("$commit")
      done
      ((${#listed[@]} > 0)) || continue
      unchanged=0
      echo "$file"
      for commit in "${listed[@]}"; do
        git --no-pager log -1 --format='%h %s%n%b' "$commit" | sed -e '${/^$/d}' -e '1s/^/  /' -e '2,$s/^./    &/'
      done
    done
    ((unchanged == 0)) || echo "Unchanged in HEAD."
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
  changes) (($# == 1)) || usage; list_changes ;;
  clear)
    # An empty name would match the records of every branch.
    if (($# != 2)) || [[ -z "$2" ]]; then usage; fi
    clear_records "$2"
    ;;
  *) usage ;;
esac
