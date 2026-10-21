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
#                   whose change HEAD no longer holds, with the commits
#                   that touched them; its cases: test-handoff-cases.sh
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

# Whether a file still holds a suite's change to it: the lines the suite
# added are all in HEAD's version, in their order. A loosened assertion, a
# dropped case or a test thrown away before its commit breaks the sequence;
# a later suite that adds cases to the file does not. Blank lines are left
# out. A suite that only removed lines, or the file, compares whole.
kept_in_head() {
  local ref="$1" file="$2"
  if ! git cat-file -e "$ref:$file" 2>/dev/null; then
    if git cat-file -e "HEAD:$file" 2>/dev/null; then
      return 1
    fi
    return 0
  fi
  if ! git diff --unified=0 "$ref^" "$ref" -- "$file" | grep -q '^+[^+]*[^[:space:]+]'; then
    git diff --quiet "$ref" HEAD -- "$file"
    return
  fi
  # i starts at 0: unset, it would index wanted[""], not wanted[0].
  awk 'BEGIN { i = 0 }
       NR == FNR { if ($0 ~ /[^[:space:]]/) wanted[n++] = $0; next }
       i < n && $0 == wanted[i] { i++ }
       END { exit (i < n) }' \
    <(git diff --unified=0 "$ref^" "$ref" -- "$file" | sed -n '/^+++ /d; s/^+//p') \
    <(git show "HEAD:$file" 2>/dev/null)
}

list_changes() {
  local branch ref file commit unchanged
  local -a refs files commits
  branch="$(task_branch)"
  mapfile -t refs < <(records_of "$branch")
  if ((${#refs[@]} == 0)); then
    echo "No suite recorded on $branch."
    return
  fi
  for ref in "${refs[@]}"; do
    mapfile -t files < <(git diff --name-only "$ref^" "$ref")
    echo "== Suite ${ref##*/}, written on $(git log -1 --format='%h %s' "$ref^")"
    unchanged=1
    for file in "${files[@]}"; do
      kept_in_head "$ref" "$file" && continue
      unchanged=0
      echo "$file"
      # Every commit since the record that touched the file, the one that
      # landed the suite included: telling them apart from history alone
      # hid changes, since a record holds the whole tree.
      mapfile -t commits < <(git log --format=%H "$ref^..HEAD" -- "$file")
      if ((${#commits[@]} == 0)); then
        echo "  not committed as recorded"
      fi
      for commit in "${commits[@]}"; do
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
