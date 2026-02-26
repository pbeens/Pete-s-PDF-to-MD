#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

cd "${repo_root}"

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'npm is required to build the macOS DMG.'
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  printf '%s\n' 'npx is required to run electron-builder.'
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  printf '%s\n' 'Missing node_modules. Run: npm install'
  exit 1
fi

printf '%s\n' 'Building macOS DMG...'
npx electron-builder --mac dmg "$@"
printf '%s\n' 'Build complete. Artifacts are in dist/.'
