#!/usr/bin/env bash
# Runs once, at the creation of the dev container, after the firewall is up.
set -euo pipefail

git config core.hooksPath .githooks

# `pnpm verify` diffs against a local main, which a clone of a branch lacks.
# Needs no network nor SSH agent; without origin/main it warns and goes on, so
# that the install still runs.
git rev-parse --verify -q refs/heads/main >/dev/null ||
  git branch main origin/main ||
  echo "warning: no origin/main, 'pnpm verify' needs a local main" >&2

pnpm install
