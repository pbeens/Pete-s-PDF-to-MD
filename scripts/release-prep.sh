#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

cd "${repo_root}"

usage() {
  printf '%s\n' "Usage: ./scripts/release-prep.sh --version <x.y.z> [--build]"
}

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required.'
  exit 1
fi

version=""
should_build="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      version="${2:-}"
      shift 2
      ;;
    --build)
      should_build="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${version}" ]]; then
  printf '%s\n' 'Missing required argument: --version <x.y.z>'
  usage
  exit 1
fi

if [[ ! "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Invalid version "%s". Expected semantic version format x.y.z\n' "${version}"
  exit 1
fi

package_version="$(node -p "require('./package.json').version")"
if [[ "${package_version}" != "${version}" ]]; then
  printf 'Version mismatch: package.json=%s, expected=%s\n' "${package_version}" "${version}"
  exit 1
fi

if ! grep -q "## \[${version}\] -" CHANGELOG.md; then
  printf 'Missing changelog section for version %s in CHANGELOG.md\n' "${version}"
  exit 1
fi

if ! grep -q "v${version}" README.md; then
  printf 'README.md does not reference v%s\n' "${version}"
  exit 1
fi

if ! grep -q "https://github.com/pbeens/Pete-s-PDF-to-MD/releases" README.md; then
  printf '%s\n' 'README.md is missing the GitHub Releases URL.'
  exit 1
fi

printf 'Release metadata checks passed for v%s\n' "${version}"

if [[ "${should_build}" == "true" ]]; then
  printf '%s\n' 'Running macOS DMG build...'
  npm run build:mac
fi
