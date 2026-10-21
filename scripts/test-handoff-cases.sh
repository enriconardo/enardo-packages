#!/usr/bin/env bash
set -euo pipefail

# The cases of `test-handoff.sh changes`, each in a throwaway repository:
# run after a change to it. The checkpoint 2 report relies on its output,
# and several histories that hid a changed test came from review rounds.
# Runs on the host, where git runs.
#
#   scripts/test-handoff-cases.sh [script]   default: this repo's script

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$(realpath "${1:-$ROOT_DIR/scripts/test-handoff.sh}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

T=scripts/test-handoff.sh
failed=0
out=""

fresh() {
  cd "$work"
  rm -rf repo
  git init -q -b main repo
  cd repo
  git config user.email cases@example.com
  git config user.name cases
  mkdir -p scripts p/__tests__ q/__tests__
  cp "$script" "$T"
  git add -A
  git commit -qm "base"
  git checkout -q -b test/repo/x
}

# A commit listed under a file: indented, after its hash.
commit_line() {
  printf '^  [0-9a-f]* %s' "${1:-}"
}

expect() {
  if grep -q -- "$2" <<<"$out"; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    printf '%s\n' "$out" | sed 's/^/     /'
    failed=1
  fi
}

expect_not() {
  if grep -q -- "$2" <<<"$out"; then
    echo "FAIL $1"
    printf '%s\n' "$out" | sed 's/^/     /'
    failed=1
  else
    echo "ok   $1"
  fi
}

expect_count() {
  local count
  count="$(grep -c -- "$2" <<<"$out" || true)"
  if ((count == $3)); then
    echo "ok   $1"
  else
    echo "FAIL $1: $count, not $3"
    printf '%s\n' "$out" | sed 's/^/     /'
    failed=1
  fi
}

record() {
  "$T" record >/dev/null
}

commit() {
  git add -A
  git commit -qm "$@"
}

fresh
echo one >p/__tests__/a.test.ts
record
commit "[p] feat: land a"
echo q >q/__tests__/q.test.ts
record
commit "[q] feat: land q"
sed -i 's/one/loose/' p/__tests__/a.test.ts
commit "[p] test: loosen a" -m "The reason."
out="$("$T" changes)"
expect "a loosened test is listed with its commit" "$(commit_line '\[p\] test: loosen a')"
expect "and the commit's body" "^    The reason."
expect "an untouched suite is unchanged" "Unchanged in HEAD."
expect_not "the commit landing a suite as recorded is not listed" "$(commit_line '\[p\] feat: land a')"

fresh
echo one >p/__tests__/a.test.ts
record
commit "[p] feat: step one"
echo two >>p/__tests__/a.test.ts
record
commit "[p] feat: step two"
echo three >q/__tests__/q.test.ts
record
commit "[q] feat: step three"
out="$("$T" changes)"
expect_not "suites sharing a file, landed as recorded, list nothing" "$(commit_line)"
expect_count "and print three unchanged suites" "^Unchanged in HEAD.$" 3

fresh
echo 'toThrow(Foo)' >p/__tests__/a.test.ts
record
echo 'toThrow()' >p/__tests__/a.test.ts
commit "[p] feat: step one loosened"
echo b >q/__tests__/b.test.ts
record
commit "[q] feat: step two"
out="$("$T" changes)"
expect "a test loosened before a later suite is listed" "$(commit_line '\[p\] feat: step one loosened')"

fresh
printf 'base\ns1 case\n' >p/__tests__/a.test.ts
record
commit "[p] feat: step one"
echo 's2 case' >>p/__tests__/a.test.ts
record
commit "[p] feat: step two"
printf 'base\ns1 case\n' >p/__tests__/a.test.ts
commit "[p] test: drop the s2 case" -m "Its reason."
out="$("$T" changes)"
expect "a later suite's dropped case is listed" "$(commit_line '\[p\] test: drop the s2 case')"

fresh
echo base >p/__tests__/a.test.ts
commit "[p] test: base"
echo case >>p/__tests__/a.test.ts
echo b >p/__tests__/b.test.ts
record
git checkout -q -- p/__tests__/a.test.ts
rm p/__tests__/b.test.ts
echo impl >p/impl.ts
commit "[p] feat: impl only"
out="$("$T" changes)"
expect "a changed test never committed is listed" "^p/__tests__/a.test.ts"
expect "a new test never committed is listed" "^p/__tests__/b.test.ts"

fresh
echo base >p/__tests__/a.test.ts
commit "[p] test: base"
echo 'case A' >>p/__tests__/a.test.ts
record
git checkout -q -- p/__tests__/a.test.ts
echo impl >p/impl.ts
commit "[p] feat: step one"
echo 'case B' >>p/__tests__/a.test.ts
record
commit "[p] feat: step two"
out="$("$T" changes)"
expect "a case dropped before a later suite on its file is listed" "^p/__tests__/a.test.ts"

fresh
echo one >p/__tests__/a.test.ts
record
commit "[p] feat: land a"
git checkout -q main
echo other >q/__tests__/other.test.ts
commit "[q] test: on main"
git checkout -q test/repo/x
git merge -q --no-edit main
out="$("$T" changes)"
expect "a merge of main leaves a suite unchanged" "Unchanged in HEAD."

fresh
printf "it('empty')\n  toThrow(ValidationError)\n" >p/__tests__/a.test.ts
record
printf "it('empty')\n  toThrow()\n" >p/__tests__/a.test.ts
commit "[p] feat: create users"
printf "it('blank')\n  toThrow(ValidationError)\n" >>p/__tests__/a.test.ts
commit "[p] test: reject a blank name"
out="$("$T" changes)"
expect "a loosened line repeated by a later test is listed" "$(commit_line '\[p\] feat: create users')"

fresh
printf "it('send')\n  rejects(DeliveryError)\n" >p/__tests__/a.test.ts
record
printf "it('send')\n  mockRejected(DeliveryError)\n  rejects(DeliveryError)\n" >p/__tests__/a.test.ts
commit "[p] feat: send welcome"
out="$("$T" changes)"
expect "a line inserted into a recorded test is listed" "$(commit_line '\[p\] feat: send welcome')"

fresh
echo "toEqual({ id: '1' })" >p/__tests__/a.test.ts
record
commit "[p] feat: step one"
printf "toEqual({ id: '1', name: 'a' })\nit('b')\n" >p/__tests__/a.test.ts
record
commit "[p] feat: step two"
out="$("$T" changes)"
expect_not "a later suite that edits an earlier one's line is no change" "$(commit_line)"

fresh
echo one >p/__tests__/a.test.ts
record
out="$("$T" changes)"
expect "a suite recorded and not committed yet says so" "^  not committed as recorded"

exit "$failed"
