#!/usr/bin/env bash
set -euo pipefail

# Runs the given test files, paths from the repo's root, and prints one JUnit
# XML document: the workflow's `run_tests`. Vitest runs in the package that
# owns each file, since the `~` alias and the projects are per package; each
# package's report is merged into a single <testsuites>, which the workflow
# reads as one document. Vitest's own output goes to stderr. Exits non-zero
# when a package's run fails.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if (($# == 0)); then
  echo "usage: run-tests.sh <test-file>..." >&2
  exit 2
fi

reports="$(mktemp -d)"
trap 'rm -rf -- "$reports"' EXIT

declare -A files_of=()
packages=()
for file in "$@"; do
  file="${file#./}"
  if [[ "$file" != packages/*/* ]]; then
    echo "run-tests.sh: $file is not in a package" >&2
    exit 2
  fi
  package="$(cut -d/ -f2 <<<"$file")"
  [[ -n "${files_of[$package]+set}" ]] || packages+=("$package")
  files_of[$package]+="${file#packages/"$package"/}"$'\n'
done

status=0
for package in "${packages[@]}"; do
  mapfile -t relative < <(printf '%s' "${files_of[$package]}")
  (cd "$ROOT_DIR/packages/$package" &&
    pnpm exec vitest run --reporter=junit --outputFile="$reports/$package.xml" "${relative[@]}") >&2 || status=1
done

echo '<?xml version="1.0" encoding="UTF-8" ?>'
echo '<testsuites>'
for package in "${packages[@]}"; do
  report="$reports/$package.xml"
  [[ -f "$report" ]] || continue
  # the report's own suites, without its prolog and its <testsuites> wrapper;
  # vitest names a file from the package, which would make two packages'
  # `__tests__/index.test.ts` one file: the names become paths from the root
  sed -e '/^<?xml/d' -e '/^<testsuites[ >]/d' -e '/^<\/testsuites>/d' \
    -e "s#\\(name\\|classname\\)=\"__tests__/#\\1=\"packages/$package/__tests__/#g" "$report"
done
echo '</testsuites>'

exit "$status"
