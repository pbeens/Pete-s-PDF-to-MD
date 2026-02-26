---
name: petes-pdf-release
description: Prepare and publish a macOS GitHub release for this repository, including version consistency checks, changelog/readme release updates, and DMG artifact creation. Use when the user asks to cut a release, build/upload a DMG, or verify release readiness.
---

# petes-pdf-release

Run this workflow for repository release prep:

1. Confirm target version (for example `0.5.0`).
2. Ensure `package.json` version matches.
3. Ensure `CHANGELOG.md` contains `## [<version>] - YYYY-MM-DD`.
4. Ensure `README.md` includes:
- current version (`v<version>`)
- GitHub Releases URL: `https://github.com/pbeens/Pete-s-PDF-to-MD/releases`
- DMG artifact instructions
5. Run metadata checks:
- `npm run release:prep -- --version <version>`
6. Build DMG when requested:
- `npm run release:prep -- --version <version> --build`
7. Verify artifact exists in `dist/` and report exact filename.
8. In the final response, provide:
- release tag suggestion (`v<version>`)
- upload path (`dist/<artifact>.dmg`)
- any blocker (for example no network for `npm install`).

If build fails because dependencies are missing, run `npm install` and retry. If network is unavailable, report that limitation and stop after metadata checks.
