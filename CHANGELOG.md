# Changelog

All notable changes to this project are documented in this file.

## [0.5.0] - 2026-02-26

### Added

- Cross-platform Phase 1 conversion pipeline:
- `scripts/phase1.js` launcher (Node.js).
- `scripts/extract_outline.py` extractor (Python + PyMuPDF).
- Output generation for `outline.json`, `outline.md`, `segments.json`, and section markdown files.
- Minimal Electron desktop GUI:
- PDF picker and output-folder picker.
- Conversion runner that uses the Phase 1 pipeline.
- Outline/section browsing and section markdown preview.
- "Open output folder" action from the app.
- Progress signaling from conversion subprocess to GUI.
- macOS release packaging entrypoint:
- `scripts/build-mac.sh`
- `npm run build:mac` for generating a DMG artifact.

### Changed

- Release version baseline set to `v0.5.0`.
- README updated with release and macOS DMG instructions.
