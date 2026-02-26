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

### macOS DMG Build (Release Artifact)

1. `npm install`
2. `npm run release:prep -- --version 0.5.0 --build`
3. Upload generated DMG from `dist/` to:
   `https://github.com/pbeens/Pete-s-PDF-to-MD/releases`

Expected artifact name:

- `Pete-s-PDF-to-MD-v0.5.0-macOS.dmg`

Note:

- `dist/mac/*.app` is a normal intermediate artifact.
- Upload the `.dmg` file from `dist/` to GitHub Releases.

### Windows PC Build (Release Artifact)

Run on a Windows machine (PowerShell):

1. `npm install`
2. `npm run build:win`
3. Upload generated installer from `dist/` to:
   `https://github.com/pbeens/Pete-s-PDF-to-MD/releases`

Expected artifact type:

- `dist/*.exe` (NSIS installer)

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

## License

This project is licensed under GPL-3.0. See `LICENSE`.
