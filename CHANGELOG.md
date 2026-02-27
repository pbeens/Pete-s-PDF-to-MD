# Changelog

All notable changes to this project are documented in this file.

## [0.5.0] - 2026-02-26

### Added

- Cross-platform Phase 1 conversion pipeline.
- `scripts/phase1.js` launcher (Node.js) and `scripts/extract_outline.py` extractor (Python + PyMuPDF).
- Output generation for `outline.json`, `outline.md`, `segments.json`, and section markdown files.
- Electron desktop GUI with PDF selection, output-folder selection, conversion run, outline preview, section browsing, and output-folder open action.
- Release workflow scripts:
- `scripts/build-mac.sh`
- `scripts/release-prep.sh`
- npm scripts:
- `build:mac`
- `build:win`
- `release:prep`
- Local skill for release workflow:
- `.agents/skills/petes-pdf-release/SKILL.md`

### Changed

- Release version baseline set to `v0.5.0`.
- Electron Builder config updated for packaged runtime reliability:
- `asarUnpack` includes `scripts/**`
- build resources configured under `build.directories`
- default macOS target remains DMG
- Default app output root moved to user documents:
- `~/Documents/Pete's PDF to MD Output`
- `.gitignore` updated to ignore `dist/` artifacts.
- README consolidated to one canonical "Build From Source" release-build section.

### Fixed

- Packaged app conversion failure `spawn ENOTDIR` by using packaged-safe script paths and working directory in `electron/main.cjs`.
- Packaged app subprocess mode by setting `ELECTRON_RUN_AS_NODE=1` for conversion child process.
- Script path resolution in packaged builds by adding robust `extract_outline.py` lookup in `scripts/phase1.js`.
- "Output directory not found" behavior by ensuring output root exists and falling back to opening root when per-PDF folder is not yet created.
- PyMuPDF detection issues in packaged app by probing multiple Python interpreters and allowing override via `PDF_TO_MD_PYTHON` / `PYTHON_BIN`.

### Docs

- README expanded with:
- source build instructions for macOS and Windows
- release upload guidance for GitHub Releases
- troubleshooting for:
- `.app` vs `.dmg` output confusion
- `spawn ENOTDIR`
- missing PyMuPDF in packaged runs
- output-folder open errors
