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

## Skills

### Available skills

- petes-pdf-release: Prepare and publish a macOS GitHub release, including version checks, changelog/README release updates, and DMG build flow. (file: `.agents/skills/petes-pdf-release/SKILL.md`)
