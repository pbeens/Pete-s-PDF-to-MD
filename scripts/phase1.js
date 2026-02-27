#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const opts = {
    input: '',
    outDir: 'output',
    engine: 'auto',
    maxSectionChars: '8000',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      opts.input = argv[++i] || '';
    } else if (arg === '--out-dir' || arg === '-o') {
      opts.outDir = argv[++i] || 'output';
    } else if (arg === '--engine') {
      opts.engine = (argv[++i] || 'auto').toLowerCase();
    } else if (arg === '--max-section-chars') {
      opts.maxSectionChars = argv[++i] || '8000';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!opts.input) {
      opts.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!opts.input) {
    const defaultPdf = findFirstPdf(path.join(process.cwd(), 'test-data', 'pdfs'));
    if (defaultPdf) {
      opts.input = defaultPdf;
    }
  }

  if (!opts.input) {
    throw new Error('No input PDF provided and none found in test-data/pdfs.');
  }

  return opts;
}

function printHelp() {
  console.log('Usage: node scripts/phase1.js --input <file.pdf> [--out-dir output] [--engine auto|pymupdf] [--max-section-chars 8000]');
}

function findFirstPdf(dir) {
  if (!fs.existsSync(dir)) return '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      return path.join(dir, entry.name);
    }
  }
  return '';
}

function commandExists(command, args = ['--version']) {
  const check = spawnSync(command, args, { stdio: 'ignore' });
  return check.status === 0;
}

function hasPyMuPDF(pythonBin) {
  const code = 'import fitz';
  const check = spawnSync(pythonBin, ['-c', code], { stdio: 'ignore' });
  return check.status === 0;
}

function findPythonCandidates() {
  const candidates = [];
  const seen = new Set();

  const add = (value) => {
    const item = String(value || '').trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    candidates.push(item);
  };

  add(process.env.PDF_TO_MD_PYTHON);
  add(process.env.PYTHON_BIN);
  add('python3');
  add('python');
  add('/opt/homebrew/bin/python3');
  add('/usr/local/bin/python3');
  add('/opt/homebrew/bin/python');
  add('/usr/local/bin/python');

  return candidates.filter((bin) => commandExists(bin));
}

function resolveEngine(requested) {
  if (requested !== 'auto' && requested !== 'pymupdf') {
    throw new Error(`Unsupported engine: ${requested}`);
  }

  const pythonCandidates = findPythonCandidates();
  if (pythonCandidates.length === 0) {
    throw new Error('Python is required for Phase 1. Install Python 3 and try again.');
  }

  if (requested === 'pymupdf' || requested === 'auto') {
    for (const pythonBin of pythonCandidates) {
      if (hasPyMuPDF(pythonBin)) {
        return { engine: 'pymupdf', pythonBin };
      }
    }
    const installHintBin = pythonCandidates[0];
    throw new Error(
      `PyMuPDF is not installed for detected Python interpreters (${pythonCandidates.join(', ')}). `
      + `Install with: ${installHintBin} -m pip install pymupdf`
    );
  }

  throw new Error('No compatible engine found.');
}

function resolveExtractScriptPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'extract_outline.py') : '',
    path.join(__dirname, 'extract_outline.py'),
    path.join(process.cwd(), 'scripts', 'extract_outline.py'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || '';
}

function run() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(opts.input);
  console.log(`PROGRESS: Preparing input ${path.basename(inputPath)}`);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let selected;
  try {
    console.log('PROGRESS: Resolving conversion engine');
    selected = resolveEngine(opts.engine);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const scriptPath = resolveExtractScriptPath();
  if (!fs.existsSync(scriptPath)) {
    console.error(`Extraction script not found: ${scriptPath}`);
    process.exit(1);
  }
  console.log(`PROGRESS: Running ${selected.engine} extraction`);
  const child = spawnSync(
    selected.pythonBin,
    [
      scriptPath,
      '--input', inputPath,
      '--out-dir', opts.outDir,
      '--max-section-chars', String(opts.maxSectionChars),
    ],
    { stdio: 'inherit' }
  );

  if (child.status !== 0) {
    process.exit(child.status || 1);
  }
  console.log('PROGRESS: Core extraction complete; waiting for subprocess exit and file flush');
}

run();
