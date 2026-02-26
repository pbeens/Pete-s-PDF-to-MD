# prompts.md

Chronological log of prompts used while building this project.

## Entries

| UTC Timestamp | Role | Prompt / Summary | Notes |
|---|---|---|---|
| 2026-02-26T14:55:08Z | user | Requested project setup advice: language, architecture, and best PDF-to-Markdown libraries. | Focus: accuracy + standalone distribution. |
| 2026-02-26T14:55:08Z | user | Asked licensing impact of using Marker with MIT. | Evaluated GPL/model-license constraints. |
| 2026-02-26T14:55:08Z | user | Confirmed willingness to change project license for best open-source accuracy. | Moved toward GPL path. |
| 2026-02-26T14:55:08Z | user | Confirmed long-term non-commercial intent. | Chose GPL + Marker-first recommendation. |
| 2026-02-26T14:55:08Z | user | Requested setup tasks: PDF test folder, README/license update, prompts log, and ongoing time/token tracking. | Current task. |
| 2026-02-26T14:55:08Z | user | Requested `.gitignore` for test data and asked how to approach heading-outline extraction/splitting (prototype vs full app). | Prefer phased path focused on heading accuracy first. |
| 2026-02-26T14:55:08Z | user | Requested skill-driven workflow similar to Anti-Gravity (`.agents` style) and slash-style commands like `/rebuild` and `/run`. | Added AGENTS mapping + local skill + scripts. |
| 2026-02-26T14:55:08Z | user | Requested wiring `/rebuild` and `/run` plus start of Phase 1 implementation. | Began with Swift prototype, then pivoted. |
| 2026-02-26T14:55:08Z | user | Asked whether the approach was macOS-only. | Confirmed Swift/PDFKit path was macOS-only. |
| 2026-02-26T14:55:08Z | user | Requested cross-platform direction for Mac + PC use. | Implemented Node launcher + Python/PyMuPDF extractor scaffold. |
| 2026-02-26T14:55:08Z | user | Reported Phase 1 quality issues: possible mid-sentence starts, missing line breaks/formatting, and `Extract <n>` confusion in sections. | Improved heading boundary slicing, text cleanup, and output regeneration behavior. |
| 2026-02-26T14:55:08Z | user | Requested next pass focused on sentence boundaries, paragraph grouping, and heading/body cleanup. | Implemented line-merge + paragraph reconstruction + section cleanup heuristics. |
| 2026-02-26T14:55:08Z | user | Reported bullet continuation wrapping issue in `009-students` section output. | Adjusted list-item continuation grouping for wrapped bullet lines. |

| 2026-02-26T14:55:08Z | user | Requested outline display format update to include level + line/char metrics per heading. | Implemented `Lx pN (lines: a, chars: b) Title` in outline output. |

| 2026-02-26T14:55:08Z | user | Reported `011-teachers` truncation and misplaced footnote reference. | Fixed cross-page heading boundary handling and footnote/continuation placement for this section. |

| 2026-02-26T14:55:08Z | user | Requested new slash command `/outline` to open/preview generated outline markdown directly. | Added command mapping and preview script `scripts/outline.sh`. |

| 2026-02-26T14:55:08Z | user | Requested starting a GUI and approved Electron-based minimal shell around existing pipeline. | Added Electron scaffold (`electron/` + `app/`) wired to `scripts/phase1.js`. |

| 2026-02-26T14:55:08Z | user | Reported GUI issues after npm install: fixed output path, outline preview missing, and app process not exiting on close. | Added output-folder selection, outline fallback rendering, and quit-on-window-close behavior. |
| 2026-02-26T17:15:26Z | user | Requested visible date/time stamp in GUI title bar to verify latest build is running. | Added launch timestamp + app version in window title and UI build stamp. |
| 2026-02-26T17:20:38Z | user | Reported GUI still stuck at "Running conversion" with missing outline/sections after conversion appears complete. | Reworked Electron conversion execution to deterministic `spawnSync` with explicit timeout/error handling. |
| 2026-02-26T17:22:48Z | user | Reported conversion now completes but spinner remains and sections outline still does not load. | Made first-section auto-load non-blocking and added section IPC timeout handling in renderer. |
| 2026-02-26T17:25:52Z | user | Reported no difference after previous spinner/sections fix attempt. | Switched conversion runner back to async non-blocking spawn and disabled automatic first-section content load to avoid UI lock during render. |
| 2026-02-26T18:46:14Z | user | Reported app still stuck on "Running conversion", cannot select another PDF, and sections do not appear. | Added renderer-side conversion timeout/recovery path and hardened main-process conversion timer initialization race. |
| 2026-02-26T18:48:30Z | user | Reported controls remain disabled and status stuck on running conversion with no sections visible. | Added renderer watchdog/unlock behavior and non-blocking timeout recovery so controls re-enable even if conversion IPC hangs. |
| 2026-02-26T18:50:25Z | user | Reported absolutely no difference after unlock/watchdog update. | Reworked conversion click handler to fully non-blocking promise flow so UI remains responsive even if conversion IPC never resolves. |
| 2026-02-26T18:56:30Z | user | Requested section list not jump on click and richer per-level typography in section entries. | Removed list re-render on selection (preserves scroll) and added level-based styled section metadata/title rows. |
| 2026-02-26T18:59:01Z | user | Requested more granular conversion status with specific activity details instead of generic running message. | Added end-to-end conversion progress events (pipeline stage markers from scripts -> Electron IPC -> live status text updates in renderer). |
| 2026-02-26T19:01:36Z | user | Asked what "extraction pipeline complete" means during long wait and requested a title-only tree-style section list. | Clarified/fixed progress wording with ongoing finalization heartbeat and simplified sections list to title-only tree indentation. |
| 2026-02-26T19:08:01Z | user | Reported long wait at finalization stage and requested stronger reassurance/progress plus fix for layout jump when switching sections. | Added per-second elapsed conversion ticker + richer file/title progress updates, clarified finalization messaging, and stabilized status/path layout to prevent visual jump. |
| 2026-02-26T19:12:25Z | user | Reported status text cutoff with ellipses, requested ISO date format, more explicit finalization details, and no panel jump on section click. | Switched build timestamp to ISO-8601, removed status ellipsis clipping behavior, added finalization snapshot telemetry (sections/outline/idle/elapsed), and stabilized layout/scrollbar geometry to reduce panel jumping. |
| 2026-02-26T19:14:30Z | user | Requested collapsible outline preview to free content width and move status to its own second line to avoid clipping. | Added collapsible outline panel with persisted state and restructured status row into two-line layout with dedicated full-width status line. |
| 2026-02-26T19:18:52Z | user | Requested more confidence during finalizing (what file/stage is active) and a checkbox to render markdown in Section Content. | Added heartbeat details with latest section filename/age plus section count/outline state, and added a persistent Render Markdown toggle with basic rendered preview mode. |
| 2026-02-26T19:27:10Z | user | Reported finalizing still felt ambiguous and requested Render Markdown on same line; also reported wasted Section Content space and input/output alignment regressions. | Added last active stage in finalizing heartbeat, moved Render Markdown into Section Content header line, tightened content panel row sizing, and improved status-row input/output truncation behavior. |
| 2026-02-26T19:33:56Z | user | Reported ongoing uncertainty during long finalizing wait and UI polish issues (path wrapping, markdown tables/lists spacing) with screenshot evidence. | Added explicit finalizing hint when only waiting for Python exit, implemented middle-ellipsis path display for input/output, improved markdown rendering for tables, and reduced rendered-list spacing gaps. |
| 2026-02-26T19:38:22Z | user | Questioned glossary "stuck" signal validity, requested tighter rendered markdown spacing, and asked if it runs on Windows PC. | Renamed status field to `last-written` for clarity, improved list-item continuation parsing, tightened rendered markdown spacing, and confirmed cross-platform requirements for Windows use. |
| 2026-02-26T19:43:52Z | user | Reported remaining path-wrap issue, asked for middle ellipsis in section path too, and highlighted overly aggressive markdown wrapping with screenshot evidence. | Enforced middle-ellipsis path rendering for input/output/section path, reduced renderer list-continuation aggressiveness, and refined finalizing hint to explicitly indicate no active file processing while awaiting Python exit. |

| 2026-02-26T19:51:33Z | user | Asked why final file-flush wait is long and requested renaming repo/folder to Pete's PDF to MD with docs readiness for GitHub + PC testing. | Renamed project folder, updated branding/title/package metadata, and prepared cross-platform publish/test guidance. |

| 2026-02-26T19:54:11Z | user | Asked whether README includes full PC and Mac run instructions before reopening VS Code in renamed folder. | Updated README with explicit prerequisites and run steps for macOS and Windows (PowerShell), including PyMuPDF install guidance. |

## Logging Rule

Add one row for each substantial user request and each major planning prompt used during development.
