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

function resolveEngine(requested) {
  if (requested !== 'auto' && requested !== 'pymupdf') {
    throw new Error(`Unsupported engine: ${requested}`);
  }

  const pythonBin = commandExists('python3') ? 'python3' : (commandExists('python', ['--version']) ? 'python' : '');
  if (!pythonBin) {
    throw new Error('Python is required for Phase 1. Install Python 3 and try again.');
  }

  if (requested === 'pymupdf' || requested === 'auto') {
    if (!hasPyMuPDF(pythonBin)) {
      throw new Error('PyMuPDF is not installed. Install with: pip install pymupdf');
    }
    return { engine: 'pymupdf', pythonBin };
  }

  throw new Error('No compatible engine found.');
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

  const scriptPath = path.join(process.cwd(), 'scripts', 'extract_outline.py');
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
