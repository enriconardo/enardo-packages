#!/usr/bin/env bash
set -euo pipefail

# Compares the playwright version of the image (docker/playwright/Dockerfile)
# with the catalog's (pnpm-workspace.yaml), and with every version the
# lockfile installs.
#
# A test run cannot be trusted to: the server refuses a client of another
# minor version only, so a patch apart connects. And turbo can replay a run
# that passed against a container not yet rebuilt from the Dockerfile. So
# `pnpm verify` runs this on every call, outside turbo's cache.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

unquote() {
  tr -d "'\"\r"
}

image="$(sed -n 's/^ARG PLAYWRIGHT_VERSION=//p' "$ROOT_DIR/docker/playwright/Dockerfile" | unquote)"
# Within the catalog block only: another block may have a playwright key too.
catalog="$(sed -n '/^catalog:/,/^[^ #]/s/^  playwright: //p' "$ROOT_DIR/pnpm-workspace.yaml" | unquote)"
# What is installed: a package's own version or an override shows here too.
installed="$(sed -n 's/^  playwright@\([^:(]*\):\r\{0,1\}$/\1/p' "$ROOT_DIR/pnpm-lock.yaml" | sort -u)"

if [[ -z "$image" || -z "$catalog" || -z "$installed" ]]; then
  echo "Cannot read the playwright version: '$image' in docker/playwright/Dockerfile, '$catalog' in the catalog, '$installed' in pnpm-lock.yaml." >&2
  exit 1
fi

if [[ "$image" != "$catalog" ]]; then
  echo "playwright is $image in docker/playwright/Dockerfile and $catalog in the catalog (pnpm-workspace.yaml): they must be the same." >&2
  exit 1
fi

if [[ "$installed" != "$image" ]]; then
  echo "pnpm-lock.yaml installs playwright $(echo "$installed" | paste -sd ' ' -), and docker/playwright/Dockerfile has $image: run pnpm install, and give no package a playwright version of its own." >&2
  exit 1
fi
