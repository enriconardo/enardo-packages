#!/usr/bin/env bash
set -euo pipefail

# Runs the given test files with their packages' own vitest and prints one
# JUnit XML report on stdout: the `test_files` command that Workflow
# Overload's red check runs (.workflow/config). Each suite's name gets its
# package's path, so that files of the same name in two packages stay apart.
# Runs in the dev container; vitest's own output goes to stderr.
#
#   scripts/test-files.sh packages/<name>/<path>...

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if (($# == 0)); then
  echo "Usage: scripts/test-files.sh packages/<name>/<path>..." >&2
  exit 2
fi

declare -A files=()
for file in "$@"; do
  if ! [[ "$file" =~ ^packages/([^/]+)/(.+)$ ]]; then
    echo "'$file' is not in a package: packages/<name>/<path>." >&2
    exit 2
  fi
  files["${BASH_REMATCH[1]}"]+="${BASH_REMATCH[2]}"$'\n'
done

reports="$(mktemp -d)"
trap 'rm -rf "$reports"' EXIT

status=0
echo '<?xml version="1.0" encoding="UTF-8" ?>'
echo '<testsuites>'
while IFS= read -r package; do
  mapfile -t paths < <(printf '%s' "${files[$package]}")
  (cd "packages/$package" && pnpm exec vitest run --reporter=junit --outputFile="$reports/$package.xml" "${paths[@]}") >&2 || status=1
  if [[ -f "$reports/$package.xml" ]]; then
    sed -e '/^<?xml/d' -e '/^<testsuites/d' -e '/^<\/testsuites>/d' \
      -e "s|<testsuite name=\"|<testsuite name=\"packages/$package/|" \
      -e "s|classname=\"|classname=\"packages/$package/|" \
      "$reports/$package.xml"
  fi
done < <(printf '%s\n' "${!files[@]}" | sort)
echo '</testsuites>'
exit "$status"
