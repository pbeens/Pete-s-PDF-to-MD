# Implementation Plan

## Goal

Build a standalone app that converts PDF to Markdown accurately and can split output into smaller sub-documents for LLM use.

## Options

1. Build final app immediately, with all features in one flow.
- Pros: faster path to a single distributable app.
- Cons: slower iteration on extraction quality; harder to debug heading logic.

2. Build a focused Phase 1 prototype for heading outline + split points, then integrate into final app.
- Pros: fastest way to validate accuracy and splitting strategy on real PDFs.
- Cons: one temporary CLI/prototype step before full UI packaging.

## Recommendation

Use Option 2.

Phase 1 should produce three artifacts from each PDF:

- `outline.json`: ordered headings with level, page, and confidence.
- `outline.md`: human-readable heading tree.
- `segments.json`: section boundaries for sub-document generation.

Once this is reliable on your sample PDFs, wire it into the Electron app as:

- `--extract-outline`
- `--split-by-headings`

## Proposed Milestones

1. Add a cross-platform CLI runner for local testing (`scripts/phase1.js` + `scripts/extract_outline.py`).
2. Integrate Marker as the extraction backend and normalize heading output.
3. Add heuristic cleanup (merge wrapped headers, drop false positives).
4. Add split-export modes (`single`, `By Major Heading`, `Sections`) with mode-specific output folders.
5. Integrate same pipeline into Electron UI.

## Acceptance Criteria for Phase 1

1. Heading hierarchy is readable and mostly correct on at least 3 different PDFs.
2. Split files preserve heading context and are <= configurable target size.
3. Output is deterministic across repeated runs on same input.

## UI To-Do

1. Add right-click actions for each section item: "Open in folder" and "Open in default program".
2. When selecting a different section, reset the section content pane scroll position to the top.
3. v0.7.0: Add Shift-click multi-select in Sections and a merge action to combine selected sections into one merged output.
