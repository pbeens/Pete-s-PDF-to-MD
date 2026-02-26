# session-metrics.md

Track interactive development effort and rough usage cost.

## Metrics Log

| Date (UTC) | Session Start (UTC) | Session End (UTC) | Duration (min) | Prompt Count | Est. Input Tokens | Est. Output Tokens | Est. Total Tokens | Notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| 2026-02-26 | 14:43 | in-progress | in-progress | 38 | pending | pending | pending | Active setup session; includes extraction improvements and Electron GUI scaffold plus output-path/preview/process-lifecycle fixes, runtime build-stamp visibility, conversion hang mitigation, non-blocking section-load behavior, async conversion execution, renderer timeout recovery, forced UI unlock watchdog, fully non-blocking conversion promise flow, section-list UX/typography improvements, granular conversion telemetry, richer finalization diagnostics, improved markdown/list continuation handling, robust path truncation UI behavior, and release-prep work for v0.5.0 (README + changelog + macOS DMG build script + slash-command cleanup). |

## How to Update

1. Set start/end times for each work session.
2. Count prompts from `prompts.md` for that session.
3. Fill token fields using provider dashboard values when available.
4. If exact token data is unavailable, enter best estimate and mark in notes.

## Important Limitation

Token counts are not available directly from local repository files. Use your API/provider usage dashboard for accurate totals.
