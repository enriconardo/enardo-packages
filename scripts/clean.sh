#!/usr/bin/env bash
set -euo pipefail

# Removes every node_modules and dist directory of the repo, from any working
# directory. Reinstall with `pnpm install`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find "$ROOT_DIR" -type d \( -name node_modules -o -name dist \) -prune -exec rm -rf {} +
echo "Removed every node_modules and dist directory. Reinstall with 'pnpm install'."
