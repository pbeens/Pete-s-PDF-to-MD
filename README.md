# Pete's PDF to MD

Open-source utility to convert PDF documents to high-quality Markdown for AI workflows.

## Current Version

`v0.5.0`

## Releases

- GitHub Releases: `https://github.com/pbeens/Pete-s-PDF-to-MD/releases`
- Changelog: `CHANGELOG.md`

## Requirements

- Node.js 20+ (includes `npm`)
- Python 3.10+ (or newer)
- PyMuPDF (`fitz`) Python package

Install PyMuPDF:

- macOS/Linux: `python3 -m pip install pymupdf`
- Windows (PowerShell): `py -m pip install pymupdf`

## Build From Source

### macOS

1. `npm install`
2. `python3 -m pip install pymupdf`
3. Run unpackaged app for development:
   `npm run gui`
4. Build release artifact (DMG):
   `npm run release:prep -- --version 0.5.0 --build`

Release artifact:

- `dist/Pete-s-PDF-to-MD-v0.5.0-macOS.dmg`

### Windows (PowerShell)

1. `npm install`
2. `py -m pip install pymupdf`
3. Run unpackaged app for development:
   `npm run gui`
4. Build release installer:
   `npm run build:win`

Release artifact:

- `dist/*.exe`

Upload release artifacts to:

- `https://github.com/pbeens/Pete-s-PDF-to-MD/releases`

Build notes:

- `dist/mac-arm64/*.app` is an intermediate output for macOS packaging.
- Upload the `.dmg` from `dist/` for macOS releases.

## Project Status

Early setup phase.

Current priority:

- extract a reliable heading outline from PDFs
- use headings to split output into smaller sub-documents for LLM workflows

## Testing PDFs

Put sample PDFs in:

- `test-data/pdfs/`

These files are used for manual and automated conversion quality checks.

## Prompt + Cost Tracking

This repository tracks collaboration and usage in two files:

- `prompts.md`: chronological prompt log
- `session-metrics.md`: time and token/cost tracking per session

## Planning

Implementation options and milestone plan:

- `docs/implementation-plan.md`

## Phase 1 (Cross-Platform)

Current Phase 1 implements heading outline extraction and split planning using a cross-platform backend:

- launcher: `scripts/phase1.js` (Node.js)
- extractor: `scripts/extract_outline.py` (Python + PyMuPDF)

Run:

- `npm run phase1 -- --input "test-data/pdfs/<file>.pdf"`

Outputs:

- `output/<pdf-name>/outline.json`
- `output/<pdf-name>/outline.md`
- `output/<pdf-name>/segments.json`
- `output/<pdf-name>/sections/*.md`

## GUI (Electron)

Minimal desktop UI is scaffolded and wired to the existing conversion pipeline.

Files:

- `electron/main.cjs` (main process + IPC)
- `electron/preload.cjs` (safe renderer bridge)
- `app/index.html`, `app/styles.css`, `app/renderer.js` (UI)

### macOS Run

1. `npm install`
2. `python3 -m pip install pymupdf`
3. `npm run gui`

For release packaging instructions, see **Build From Source** above.

### Windows Run (PowerShell)

1. Install Node.js (LTS) and Python 3.
2. `npm install`
3. `py -m pip install pymupdf`
4. `npm run gui`

Notes for Windows:

- GUI launch (`npm run gui`) and conversion pipeline are cross-platform.

Current GUI features:

- select a PDF file
- select output root folder
- run conversion (calls existing `scripts/phase1.js`)
- preview `outline.md`
- browse sections from `outline.json`
- view section markdown content
- open output folder

Notes:

- The app now quits when the last window is closed (so terminal returns immediately).

## Troubleshooting

### "Could not open output folder ... Output directory not found"

- The app now defaults to `~/Documents/Pete's PDF to MD Output`.
- If the error appears, set Output Folder explicitly in the app, then run conversion once.

### "Conversion failed ... spawn ENOTDIR"

- This indicates an older packaged build.
- Rebuild and reinstall using:
  `npm run release:prep -- --version 0.5.0 --build`

### "PyMuPDF is not installed"

- Install PyMuPDF for the same Python interpreter used by the app:
  `/opt/homebrew/bin/python3 -m pip install pymupdf`
- If needed, launch the app from Terminal with:
  `PDF_TO_MD_PYTHON=/opt/homebrew/bin/python3 open /Applications/Pete\\'s\\ PDF\\ to\\ MD.app`

### "I only see a .app file after build"

- `dist/mac-arm64/*.app` is an intermediate output.
- Upload `dist/Pete-s-PDF-to-MD-v0.5.0-macOS.dmg` to GitHub Releases.

## License

This project is licensed under GPL-3.0. See `LICENSE`.
