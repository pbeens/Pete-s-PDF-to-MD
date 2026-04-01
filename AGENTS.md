# AGENTS.md

Project-level operating instructions for Codex.

## Local Skills Convention

This repository keeps project skills under:

- `.agents/skills/<skill-name>/SKILL.md`

When a user request clearly matches a local skill in `.agents/skills/`, open and follow that skill.

## Execution Rules

1. Prefer deterministic scripts over ad-hoc shell commands.
2. Keep scripts idempotent where possible.
3. When adding a new workflow, expose it through `scripts/` first.

## Change/Test Gate

All code changes must pass an automated test gate before they are considered complete.

Canonical test inventory: `tests/TEST_PLAN.md`.
Executable smoke test list: `tests/cases/smoke.json`.
Latest smoke report: `tests/reports/smoke-latest.md`.
Executable regression test list: `tests/cases/regression.json`.
Latest regression report: `tests/reports/regression-latest.md`.

### Required process on every change

1. Identify impacted behavior (feature, bugfix, or regression risk).
2. Add or update at least one automated test that would fail without the change.
3. Run the fast smoke suite.
4. Run the full regression suite.
5. Only finalize when all required tests pass.

### Test sources and ownership

- Keep test inputs in `tests/pdfs/`.
- Keep generated test run outputs in `tests/runs/` (and `tests/runs-single/` for ad-hoc single-mode runs).
- Keep executable test runners in `scripts/` (deterministic, non-interactive).
- Keep package entry points in `package.json` scripts so tests are runnable by one command.

### Minimum standard for agents

- Do not treat a change as done if automated tests were not run, unless explicitly instructed.
- If tests cannot be run, report exactly why and what remains unverified.
- When behavior changes intentionally, update golden files/tests in the same change.
- Prefer adding a smoke test first for new behavior, then expand to full regression coverage.

### CI expectation

- CI should execute the same full regression command used locally.
- A pull request should be considered blocked if the regression suite fails.

## Skills

### Available skills

- petes-pdf-release: Prepare and publish a macOS GitHub release, including version checks, changelog/README release updates, and DMG build flow. (file: `.agents/skills/petes-pdf-release/SKILL.md`)
