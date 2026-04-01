# AGENTS.md

Project-level operating instructions for Codex and other contributors working in this repository.

## Project Overview

`Pete's PDF to MD` is an Electron desktop app plus a scriptable conversion pipeline that turns PDF documents into Markdown better suited for AI and LLM workflows.

The current codebase focuses on:

- extracting a reliable heading outline from a PDF
- using that outline to split the PDF content into manageable Markdown files
- supporting both command-line and desktop GUI workflows
- producing output that is easy to inspect, review, and reuse

This project is not a generic PDF renderer. Its main job is to convert structured PDFs into high-quality Markdown organized by document headings.

## Main Technologies

- Node.js 20+ for the app shell, CLI launcher, and build scripts
- Electron for the desktop GUI
- Python 3.10+ for the PDF extraction engine
- PyMuPDF (`fitz`) for reading PDF structure and text
- `electron-builder` for packaged app builds

## Repository Layout

- `README.md`: end-user setup, build, and troubleshooting guide
- `CHANGELOG.md`: release history
- `package.json`: npm scripts, app version, Electron Builder config
- `app/`: renderer-side GUI files
- `electron/`: Electron main process and preload bridge
- `scripts/phase1.js`: Node launcher for the conversion pipeline
- `scripts/extract_outline.py`: Python extraction and Markdown segmentation logic
- `scripts/build-mac.sh`: macOS packaging helper
- `scripts/release-prep.sh`: release-readiness checks and optional macOS build trigger
- `docs/implementation-plan.md`: planning notes and implementation direction
- `test-data/pdfs/`: sample PDFs for local testing
- `.agents/skills/`: project-local skills

## How The App Works

There are two main entry points:

- CLI flow: `npm run phase1 -- --input "path/to/file.pdf"`
- GUI flow: `npm run gui`

Both flows ultimately run the same conversion pipeline:

1. `scripts/phase1.js` validates arguments, finds a usable Python interpreter, and checks that PyMuPDF is installed.
2. `scripts/phase1.js` invokes `scripts/extract_outline.py`.
3. `scripts/extract_outline.py` reads the PDF, extracts or infers headings, normalizes the outline, and writes Markdown outputs plus metadata files.
4. The Electron app reads those output files back from disk and displays the outline and section content.

## Core Application Files

### Electron

- `electron/main.cjs`: app bootstrap, window creation, IPC handlers, conversion subprocess spawning, output loading, shell integrations
- `electron/preload.cjs`: safe API bridge exposed to the renderer

### Renderer

- `app/index.html`: desktop UI markup
- `app/styles.css`: desktop UI styling
- `app/renderer.js`: renderer state, event handling, outline browsing, section preview, output-mode selection

### Conversion Pipeline

- `scripts/phase1.js`: CLI wrapper and Python/PyMuPDF environment resolution
- `scripts/extract_outline.py`: primary extraction engine and output writer

## Output Model

For an input PDF named `example.pdf`, output is written under:

- `<output-root>/example/`

Common generated files:

- `outline.json`: machine-readable outline and section metadata
- `outline.md`: human-readable outline summary
- `segments.json`: split planning / segment metadata

Depending on conversion mode:

- `single`: one merged Markdown file in the output root folder for that PDF
- `sections`: one Markdown file per heading in `Sections/`
- `major`: one Markdown file per major heading in `By Major Heading/`

In the packaged GUI, the default output root is:

- `~/Documents/Pete's PDF to MD Output`

## Development Workflows

### Install

Required local dependencies:

- Node.js 20+
- Python 3.10+
- PyMuPDF installed for the same Python interpreter the app will use

Typical setup:

- `npm install`
- `python3 -m pip install pymupdf`

### Run The GUI

- `npm run gui`

### Run The CLI Pipeline

- `npm run phase1 -- --input "test-data/pdfs/<file>.pdf"`

### Build

- macOS DMG: `npm run build:mac`
- Windows installer: `npm run build:win`

### Release Prep

- `npm run release:prep -- --version <x.y.z>`
- `npm run release:prep -- --version <x.y.z> --build`

`scripts/release-prep.sh` checks:

- `package.json` version matches the requested version
- `CHANGELOG.md` has a matching release section
- `README.md` references the release version
- `README.md` includes the GitHub Releases URL

## Local Skills Convention

This repository keeps project skills under:

- `.agents/skills/<skill-name>/SKILL.md`

When a user request clearly matches a local skill in `.agents/skills/`, open and follow that skill.

## Project Skill

### Available skills

- `petes-pdf-release`: prepare and publish a macOS GitHub release, including version checks, changelog/README release updates, and DMG build flow. File: `.agents/skills/petes-pdf-release/SKILL.md`

Use this skill when the task is about release preparation, DMG packaging, or release publication.

## Execution Rules

1. Prefer deterministic scripts over ad-hoc shell commands.
2. Keep scripts idempotent where possible.
3. When adding a new workflow, expose it through `scripts/` first.
4. Prefer extending the existing CLI or packaging scripts over embedding one-off behavior inside documentation.
5. Preserve cross-platform behavior where practical. The current repo supports macOS and Windows, and the CLI pipeline is designed to be cross-platform.

## Code Change Guidance

- Keep the GUI and CLI pipeline aligned. If a conversion behavior changes, check whether both entry points still work consistently.
- Do not break the packaged-app path logic. The app distinguishes between dev mode and packaged mode when resolving script locations.
- Treat `scripts/extract_outline.py` as the source of truth for extraction behavior.
- Treat `outline.json`, `outline.md`, and segmented Markdown files as part of the public workflow; avoid changing their names or layout casually.
- When changing output folder names or layout, review both the generator and the Electron code that reads outputs back in.
- Maintain helpful failure messages. The GUI already translates several technical failures into clearer user-facing errors.

## Testing Guidance

There is no large automated test suite in this repository yet. For changes, prefer lightweight functional verification using the real app flows.

When changing extraction or output behavior, verify with:

- `npm run phase1 -- --input "test-data/pdfs/<file>.pdf"`
- inspection of generated `outline.json`, `outline.md`, and Markdown outputs

When changing GUI behavior, verify with:

- `npm run gui`
- one conversion run through the desktop app
- outline loading, section browsing, and output-folder actions when relevant

When changing packaging or release flows, verify the relevant script directly instead of documenting assumptions.

## Documentation Guidance

- Keep `README.md` focused on end users: install, run, build, troubleshoot, release artifact locations.
- Keep `AGENTS.md` focused on contributor and agent context: architecture, workflows, conventions, and guardrails.
- If behavior changes, update the code and the relevant docs in the same turn when feasible.
- Use exact script names, paths, and output folder names. Avoid vague documentation.

## Tutorial Writing Guidance

- Tutorials should be more descriptive than concise. Do not assume the reader already knows the terminology.
- When introducing a term, acronym, tool, or concept for the first time, briefly define it in plain language before using it without explanation.
- Prefer adding a short explanation, example, or why-it-matters sentence when a step depends on unfamiliar vocabulary or prior knowledge.
- Write for a beginner reader by default. If a section uses technical language, make the meaning clear in the surrounding text instead of relying on the reader to infer it.
- If instructions mention a script, package, artifact, or build term, explain what it is and what role it plays in the workflow.

## Contributor Expectations

- Read the existing scripts before changing process behavior.
- Keep naming consistent with the rest of the repo. This project already has established names for modes, outputs, and release artifacts.
- Avoid introducing large abstractions unless they solve a concrete problem in this small codebase.
- Favor straightforward, inspectable code over cleverness.
- If you discover a repo-specific behavior that future contributors need to know, add it here instead of relying on memory.
