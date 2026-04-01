#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const CASES_FILE = path.join(ROOT, 'tests', 'cases', 'smoke.json');
const RUNS_ROOT = path.join(ROOT, 'tests', 'runs', 'smoke');
const REPORTS_DIR = path.join(ROOT, 'tests', 'reports');
const REPORT_JSON = path.join(REPORTS_DIR, 'smoke-latest.json');
const REPORT_MD = path.join(REPORTS_DIR, 'smoke-latest.md');

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

function runPhase1(args) {
  const script = path.join(ROOT, 'scripts', 'phase1.js');
  const child = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  return child;
}

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, 'utf8');
  const items = JSON.parse(raw);
  assert(Array.isArray(items) && items.length > 0, 'No smoke tests defined.');
  return items;
}

function toDocDir(outDir, fixturePath) {
  return path.join(outDir, path.parse(fixturePath).name);
}

function runCase(testCase) {
  const started = new Date();
  const caseRunDir = path.join(RUNS_ROOT, testCase.id);
  cleanDir(caseRunDir);

  const fixtureAbs = path.join(ROOT, testCase.fixture);
  assert(fs.existsSync(fixtureAbs), `Fixture not found: ${testCase.fixture}`);

  let details = {};
  try {
    if (testCase.type === 'phase1_success') {
      const child = runPhase1([
        '--input', fixtureAbs,
        '--out-dir', caseRunDir,
        '--conversion-mode', testCase.mode || 'sections',
      ]);
      assert(child.status === 0, `Expected exit 0, got ${child.status}`);

      const docDir = toDocDir(caseRunDir, fixtureAbs);
      const outlineJson = path.join(docDir, 'outline.json');
      const segmentsJson = path.join(docDir, 'segments.json');
      const outlineMd = path.join(docDir, 'outline.md');
      assert(fs.existsSync(outlineJson), 'Missing outline.json');
      assert(fs.existsSync(segmentsJson), 'Missing segments.json');
      assert(fs.existsSync(outlineMd), 'Missing outline.md');

      const sectionsDir = path.join(docDir, 'Sections');
      assert(fs.existsSync(sectionsDir), 'Missing Sections directory');
      const mdFiles = fs.readdirSync(sectionsDir).filter((f) => f.toLowerCase().endsWith('.md'));
      assert(mdFiles.length > 0, 'No section markdown files generated');

      details = { outputDir: docDir, sectionFiles: mdFiles.length };
    } else if (testCase.type === 'unsupported_engine') {
      const child = runPhase1([
        '--input', fixtureAbs,
        '--engine', 'badengine',
      ]);
      assert(child.status !== 0, 'Expected non-zero exit code');
      const combined = `${child.stdout || ''}\n${child.stderr || ''}`;
      assert(combined.includes('Unsupported engine'), 'Expected "Unsupported engine" error message');
      details = { exitCode: child.status };
    } else if (testCase.type === 'single_shape') {
      const child = runPhase1([
        '--input', fixtureAbs,
        '--out-dir', caseRunDir,
        '--conversion-mode', 'single',
      ]);
      assert(child.status === 0, `Expected exit 0, got ${child.status}`);

      const docDir = toDocDir(caseRunDir, fixtureAbs);
      const files = fs.readdirSync(docDir);
      const rootMd = files.filter((f) => f.toLowerCase().endsWith('.md') && f !== 'outline.md');
      assert(fs.existsSync(path.join(docDir, 'outline.json')), 'Missing outline.json');
      assert(fs.existsSync(path.join(docDir, 'segments.json')), 'Missing segments.json');
      assert(fs.existsSync(path.join(docDir, 'outline.md')), 'Missing outline.md');
      assert(rootMd.length === 1, `Expected 1 root markdown file, got ${rootMd.length}`);

      details = { outputDir: docDir, markdownFile: rootMd[0] };
    } else if (testCase.type === 'dot_leader_table') {
      const child = runPhase1([
        '--input', fixtureAbs,
        '--out-dir', caseRunDir,
        '--conversion-mode', testCase.mode || 'sections',
      ]);
      assert(child.status === 0, `Expected exit 0, got ${child.status}`);

      const docDir = toDocDir(caseRunDir, fixtureAbs);
      const markdownFiles = [];
      const stack = [docDir];
      while (stack.length > 0) {
        const cur = stack.pop();
        for (const name of fs.readdirSync(cur)) {
          const next = path.join(cur, name);
          const stat = fs.statSync(next);
          if (stat.isDirectory()) stack.push(next);
          if (stat.isFile() && name.toLowerCase().endsWith('.md')) markdownFiles.push(next);
        }
      }
      assert(markdownFiles.length > 0, 'No markdown files generated');

      const hit = markdownFiles.find((file) => {
        const content = fs.readFileSync(file, 'utf8');
        return content.includes('| Section | Page |') && content.includes('|---|---:|');
      });
      assert(Boolean(hit), 'Missing markdown TOC table header');

      details = { outputDir: docDir, markdownFile: path.relative(docDir, hit) };
    } else {
      throw new Error(`Unsupported test type: ${testCase.type}`);
    }

    const ended = new Date();
    return {
      id: testCase.id,
      name: testCase.name,
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
      status: 'fail',
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationMs: ended.getTime() - started.getTime(),
      error: err && err.message ? err.message : String(err),
      details,
    };
  }
}

function renderMarkdownReport(results, startedAt, endedAt) {
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.length - passCount;
  const lines = [];
  lines.push('# Smoke Test Report');
  lines.push('');
  lines.push(`- Started: ${startedAt.toISOString()}`);
  lines.push(`- Ended: ${endedAt.toISOString()}`);
  lines.push(`- Total: ${results.length}`);
  lines.push(`- Passed: ${passCount}`);
  lines.push(`- Failed: ${failCount}`);
  lines.push('');
  lines.push('| ID | Name | Status | Duration (ms) |');
  lines.push('|---|---|---|---:|');
  for (const row of results) {
    lines.push(`| ${row.id} | ${row.name} | ${row.status.toUpperCase()} | ${row.durationMs} |`);
  }
  lines.push('');
  for (const row of results.filter((r) => r.status === 'fail')) {
    lines.push(`## ${row.id} Failure`);
    lines.push('');
    lines.push(`- Error: ${row.error}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const startedAt = new Date();
  ensureDir(path.dirname(CASES_FILE));
  ensureDir(RUNS_ROOT);
  ensureDir(REPORTS_DIR);

  const cases = loadCases();
  console.log(`Running ${cases.length} smoke tests from tests/cases/smoke.json`);
  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`- ${testCase.id} ${testCase.name} ... `);
    const result = runCase(testCase);
    results.push(result);
    process.stdout.write(`${result.status.toUpperCase()}\n`);
    if (result.status === 'fail') {
      process.stdout.write(`  ${result.error}\n`);
    }
  }

  const endedAt = new Date();
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.length - passCount;

  const report = {
    suite: 'smoke',
    source: 'tests/cases/smoke.json',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    total: results.length,
    passed: passCount,
    failed: failCount,
    results,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdownReport(results, startedAt, endedAt), 'utf8');

  console.log('');
  console.log(`Smoke tests: ${passCount}/${results.length} passed`);
  console.log(`Report JSON: ${path.relative(ROOT, REPORT_JSON)}`);
  console.log(`Report MD:   ${path.relative(ROOT, REPORT_MD)}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main();
