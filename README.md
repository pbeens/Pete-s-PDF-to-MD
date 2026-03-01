# Pete's PDF to MD

Open-source utility to convert PDF documents to high-quality Markdown for AI workflows.

## Current Version

`v0.7.0`

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
   `npm run release:prep -- --version 0.7.0 --build`

Release artifact:

- `dist/Pete-s-PDF-to-MD-v0.7.0-macOS.dmg`

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
- `single` mode: `output/<pdf-name>/<pdf-name>.md` (root, no subfolder)
- `sections` mode: `output/<pdf-name>/Sections/*.md` (one merged markdown file per heading)
- `major` mode: `output/<pdf-name>/By Major Heading/*.md` (one merged markdown file per major heading)

## Extraction Accuracy

- PDF structure varies significantly across files; extracted headings, section boundaries, and text flow may not be 100% exact for every document.
- Best results come from well-structured PDFs with a reliable embedded outline/table of contents.
- Always review output before downstream publishing or automation.

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
- drag and drop a PDF onto the `Select PDF` button
- select output root folder
- choose conversion output mode: `One file`, `By major heading`, or `Individual sections`
- run conversion (calls existing `scripts/phase1.js`)
- preview `outline.md`
- browse sections from `outline.json`
- view section markdown content
- right-click section action: `Open in folder`
- right-click section action: `Open in default program`
- right-click section action: `Copy path`
- open output folder

Notes:

- The app now quits when the last window is closed (so terminal returns immediately).
- Build stamp uses local time format: `yyyy-mm-dd hh:mm`.
- Section path display uses middle truncation to preserve start and filename.

## Troubleshooting

### "Could not open output folder ... Output directory not found"

- The app now defaults to `~/Documents/Pete's PDF to MD Output`.
- If the error appears, set Output Folder explicitly in the app, then run conversion once.

### "Conversion failed ... spawn ENOTDIR"

- This indicates an older packaged build.
- Rebuild and reinstall using:
  `npm run release:prep -- --version 0.7.0 --build`

### "Conversion failed ... Output files are locked by another program"

- Close any open files, previews, or editors under the output markdown folder for the selected mode.
- Retry conversion after releasing file locks.

### "Conversion failed ... invalid/corrupt PDF"

- The file may be incomplete/corrupt or not a valid PDF despite extension.
- Open in a PDF viewer and re-export/save as a new PDF, then retry.

### "PyMuPDF is not installed"

- Install PyMuPDF for the same Python interpreter used by the app:
  `/opt/homebrew/bin/python3 -m pip install pymupdf`
- If needed, launch the app from Terminal with:
  `PDF_TO_MD_PYTHON=/opt/homebrew/bin/python3 open /Applications/Pete\\'s\\ PDF\\ to\\ MD.app`

### "I only see a .app file after build"

- `dist/mac-arm64/*.app` is an intermediate output.
- Upload `dist/Pete-s-PDF-to-MD-v0.7.0-macOS.dmg` to GitHub Releases.

## License

This project is licensed under GPL-3.0. See `LICENSE`.


