# Changelog

All notable changes to this project are documented in this file.

## [0.7.0] - 2026-03-01

### Added

- Conversion output mode options (GUI + pipeline):
- `One file` (single merged markdown output), `By major heading` (one file per top-level heading group), and `Individual sections` (one file per heading; prior default behavior).
- Section context menu action: `Copy path`.

### Changed

- Phase 1 extractor now supports output grouping via `--conversion-mode single|major|sections`.
- Output files are now organized per mode:
- `One file`: writes in the document output root (no subfolder)
- `Individual sections`: writes to `Sections/`
- `By major heading`: writes to `By Major Heading/`
- In `One file` mode, output markdown filename now matches the source PDF basename (for example, `Science SNC1W.md`).
- GUI conversion options now include output mode selection and persist locally between runs.
- README and release docs updated for `v0.7.0`.

## [0.6.0] - 2026-02-27

### Added

- Input PDF drag-and-drop support with validation for Windows drag payload variants.
- Section context menu action: `Open in folder`.
- Section context menu action: `Open in default program`.
- Section context menu action: `Copy path`.

### Fixed

- Windows packaged app no longer opens a console window during conversion subprocess execution by setting `windowsHide: true` on Node/Python child process launches.
- Conversion failures now show a clear invalid/corrupt PDF message when PyMuPDF reports format parsing errors (for example, "no objects found"), while still including technical details.
- Section content pane now resets scroll position to top when loading a different section.
- GUI error popups now suppress long traceback/progress blocks and display concise user-facing messages.
- Rendered markdown now correctly displays inline superscript tags such as `<sup>51</sup>`.
- Conversion reliability on Windows improved by avoiding full output tree deletion; locked file scenarios now return a clear "output files are locked" message.
- Drag/drop path normalization improved for file URIs and Windows path formats.

### Changed

- Release version baseline set to `v0.6.0`.
- Path display now uses rendered-width middle truncation that preserves the start of the path and full trailing filename.
- Build stamp now displays local time in `yyyy-mm-dd hh:mm` format.
- PDF section output now writes one merged markdown file per heading (no `-part-*` section files).
- Section viewer now combines multi-part section files when reading legacy outputs created before merged-file mode.
- Drag/drop target moved from a large panel to the `Select PDF` button to reduce occupied UI space.

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
