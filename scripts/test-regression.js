#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const CASES_FILE = path.join(ROOT, 'tests', 'cases', 'regression.json');
const RUNS_ROOT = path.join(ROOT, 'tests', 'runs', 'regression');
const REPORTS_DIR = path.join(ROOT, 'tests', 'reports');
const REPORT_JSON = path.join(REPORTS_DIR, 'regression-latest.json');
const REPORT_MD = path.join(REPORTS_DIR, 'regression-latest.md');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPhase1(args, env = process.env) {
  const script = path.join(ROOT, 'scripts', 'phase1.js');
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
}

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, 'utf8');
  const items = JSON.parse(raw);
  assert(Array.isArray(items) && items.length > 0, 'No regression tests defined.');
  return items;
}

function toDocDir(outDir, fixturePath) {
  return path.join(outDir, path.parse(fixturePath).name);
}

function findMarkdownFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
}

function executeAutomatedCase(testCase) {
  const fixtureAbs = path.join(ROOT, testCase.fixture || '');
  assert(testCase.fixture, 'Missing fixture path');
  assert(fs.existsSync(fixtureAbs), `Fixture not found: ${testCase.fixture}`);

  const caseRunDir = path.join(RUNS_ROOT, testCase.id);
  cleanDir(caseRunDir);

  if (testCase.check === 'single_no_generated_toc') {
    const child = runPhase1(['--input', fixtureAbs, '--out-dir', caseRunDir, '--conversion-mode', 'single']);
    assert(child.status === 0, `Expected exit 0, got ${child.status}`);
    const docDir = toDocDir(caseRunDir, fixtureAbs);
    const mdPath = path.join(docDir, `${path.parse(fixtureAbs).name}.md`);
    assert(fs.existsSync(mdPath), `Missing markdown output: ${path.basename(mdPath)}`);
    const md = fs.readFileSync(mdPath, 'utf8');
    assert(!md.includes('| Section | Page |'), 'Generated TOC table should not be present in single-mode no-TOC fallback');
    return { outputDir: docDir };
  }

  if (testCase.check === 'single_one_heading_fallback') {
    const child = runPhase1(['--input', fixtureAbs, '--out-dir', caseRunDir, '--conversion-mode', 'single']);
    assert(child.status === 0, `Expected exit 0, got ${child.status}`);
    const docDir = toDocDir(caseRunDir, fixtureAbs);
    const outlinePath = path.join(docDir, 'outline.json');
    assert(fs.existsSync(outlinePath), 'Missing outline.json');
    const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));
    assert(Array.isArray(outline), 'Invalid outline.json');
    assert(outline.length === 1, `Expected one heading in single fallback, got ${outline.length}`);
    return { outputDir: docDir, headings: outline.length };
  }

  if (testCase.check === 'front_matter_present') {
    const child = runPhase1(['--input', fixtureAbs, '--out-dir', caseRunDir, '--conversion-mode', 'sections']);
    assert(child.status === 0, `Expected exit 0, got ${child.status}`);
    const docDir = toDocDir(caseRunDir, fixtureAbs);
    const sectionsDir = path.join(docDir, 'Sections');
    assert(fs.existsSync(sectionsDir), 'Missing Sections directory');
    const files = fs.readdirSync(sectionsDir);
    const frontMatter = files.find((f) => f.includes('front-matter') && f.toLowerCase().endsWith('.md'));
    assert(Boolean(frontMatter), 'Expected synthetic Front Matter section file');
    return { outputDir: docDir, frontMatterFile: frontMatter };
  }

  if (testCase.check === 'conversion_mode_layout') {
    const modes = ['sections', 'major', 'single'];
    const modeResults = {};

    for (const mode of modes) {
      const modeOutDir = path.join(caseRunDir, mode);
      ensureDir(modeOutDir);
      const child = runPhase1(['--input', fixtureAbs, '--out-dir', modeOutDir, '--conversion-mode', mode]);
      assert(child.status === 0, `Mode ${mode}: expected exit 0, got ${child.status}`);

      const docDir = toDocDir(modeOutDir, fixtureAbs);
      assert(fs.existsSync(path.join(docDir, 'outline.json')), `Mode ${mode}: missing outline.json`);
      assert(fs.existsSync(path.join(docDir, 'outline.md')), `Mode ${mode}: missing outline.md`);
      assert(fs.existsSync(path.join(docDir, 'segments.json')), `Mode ${mode}: missing segments.json`);

      if (mode === 'sections') {
        assert(fs.existsSync(path.join(docDir, 'Sections')), 'Mode sections: missing Sections folder');
      } else if (mode === 'major') {
        assert(fs.existsSync(path.join(docDir, 'By Major Heading')), 'Mode major: missing By Major Heading folder');
      } else {
        const docMd = path.join(docDir, `${path.parse(fixtureAbs).name}.md`);
        assert(fs.existsSync(docMd), 'Mode single: missing root markdown file');
      }

      modeResults[mode] = { outputDir: docDir };
    }
    return modeResults;
  }

  if (testCase.check === 'single_filename_matches_pdf') {
    const child = runPhase1(['--input', fixtureAbs, '--out-dir', caseRunDir, '--conversion-mode', 'single']);
    assert(child.status === 0, `Expected exit 0, got ${child.status}`);
    const docDir = toDocDir(caseRunDir, fixtureAbs);
    const expected = `${path.parse(fixtureAbs).name}.md`;
    assert(fs.existsSync(path.join(docDir, expected)), `Missing expected filename: ${expected}`);
    return { outputDir: docDir, filename: expected };
  }

  throw new Error(`Unsupported automated check: ${testCase.check || '(missing check)'}`);
}

function runCase(testCase) {
  const started = new Date();
  if (testCase.automation !== 'automated') {
    const ended = new Date();
    return {
      id: testCase.id,
      name: testCase.name,
      priority: testCase.priority || 'regression',
      automation: testCase.automation || 'pending',
      status: 'skipped',
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
      reason: testCase.notes || `Case marked as ${testCase.automation || 'pending'}`,
    };
  }

  try {
    const details = executeAutomatedCase(testCase);
    const ended = new Date();
    return {
      id: testCase.id,
      name: testCase.name,
      priority: testCase.priority || 'regression',
      automation: testCase.automation,
      status: 'pass',
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
      details,
    };
  } catch (err) {
    const ended = new Date();
    return {
      id: testCase.id,
      name: testCase.name,
      priority: testCase.priority || 'regression',
      automation: testCase.automation,
      status: 'fail',
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
      error: err && err.message ? err.message : String(err),
    };
  }
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# Regression Test Report');
  lines.push('');
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Ended: ${report.endedAt}`);
  lines.push(`- Total: ${report.total}`);
  lines.push(`- Passed: ${report.passed}`);
  lines.push(`- Failed: ${report.failed}`);
  lines.push(`- Skipped: ${report.skipped}`);
  lines.push(`- Automated Cases: ${report.automated}`);
  lines.push(`- Pending/Manual Cases: ${report.pendingOrManual}`);
  lines.push('');
  lines.push('| ID | Priority | Automation | Status | Duration (ms) |');
  lines.push('|---|---|---|---|---:|');
  for (const row of report.results) {
    lines.push(`| ${row.id} | ${row.priority} | ${row.automation} | ${row.status.toUpperCase()} | ${row.durationMs} |`);
  }
  lines.push('');

  const failures = report.results.filter((r) => r.status === 'fail');
  if (failures.length > 0) {
    for (const row of failures) {
      lines.push(`## ${row.id} Failure`);
      lines.push('');
      lines.push(`- Error: ${row.error}`);
      lines.push('');
    }
  }

  const skipped = report.results.filter((r) => r.status === 'skipped');
  if (skipped.length > 0) {
    lines.push('## Skipped Cases');
    lines.push('');
    for (const row of skipped) {
      lines.push(`- ${row.id}: ${row.reason}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  ensureDir(RUNS_ROOT);
  ensureDir(REPORTS_DIR);

  const started = new Date();
  const testCases = loadCases();
  console.log(`Running regression suite from tests/cases/regression.json (${testCases.length} cases)`);

  const results = [];
  for (const testCase of testCases) {
    process.stdout.write(`- ${testCase.id} ${testCase.name} ... `);
    const result = runCase(testCase);
    results.push(result);
    process.stdout.write(`${result.status.toUpperCase()}\n`);
    if (result.status === 'fail') {
      process.stdout.write(`  ${result.error}\n`);
    }
  }

  const ended = new Date();
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const automated = results.filter((r) => r.automation === 'automated').length;

  const report = {
    suite: 'regression',
    source: 'tests/cases/regression.json',
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    total: results.length,
    passed,
    failed,
    skipped,
    automated,
    pendingOrManual: results.length - automated,
    results,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdownReport(report), 'utf8');

  console.log('');
  console.log(`Regression summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`Report JSON: ${path.relative(ROOT, REPORT_JSON)}`);
  console.log(`Report MD:   ${path.relative(ROOT, REPORT_MD)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
