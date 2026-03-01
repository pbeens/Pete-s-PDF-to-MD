const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const APP_STARTED_AT = new Date();
const CONVERSION_PROGRESS_EVENT = 'conversion-progress';
const ALLOWED_EXTERNAL_URLS = new Set([
  'https://github.com/pbeens/Pete-s-PDF-to-MD/issues',
  'https://github.com/pbeens/Pete-s-PDF-to-MD',
  'https://buymeacoffee.com/pbeens',
]);

function buildWindowTitle() {
  return `Pete's PDF to MD v${app.getVersion()}`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: buildWindowTitle(),
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT_DIR, 'app', 'index.html'));
}

function getScriptsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts');
  }
  return path.join(ROOT_DIR, 'scripts');
}

function getConversionCwd() {
  if (app.isPackaged) {
    return app.getPath('documents');
  }
  return ROOT_DIR;
}

function getDefaultOutputRoot() {
  return path.join(app.getPath('documents'), "Pete's PDF to MD Output");
}

function ensureDirectoryExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeOutputRoot(outputRootPath) {
  if (!outputRootPath) {
    return getDefaultOutputRoot();
  }
  return path.resolve(outputRootPath);
}

function getOutputDirForInput(inputPdfPath, outputRootPath) {
  const outputRoot = normalizeOutputRoot(outputRootPath);
  const baseName = path.basename(inputPdfPath, path.extname(inputPdfPath));
  return path.join(outputRoot, baseName);
}

function safeRead(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function buildConversionFailureMessage(exitCode, outputBuffer, inputPdfPath) {
  const details = String(outputBuffer || '').trim();
  const rawLower = details.toLowerCase();
  const inputName = path.basename(inputPdfPath || 'selected file');

  if (
    rawLower.includes('fzerrorformat')
    || rawLower.includes('code=7: no objects found')
    || rawLower.includes('no objects found')
  ) {
    const friendly =
      `The selected file "${inputName}" could not be parsed as a valid PDF. `
      + 'It may be corrupt, incomplete, or not a real PDF file. '
      + 'Try opening it in a PDF viewer and exporting/saving a new PDF, then run conversion again.';
    return `Conversion failed: ${friendly}${details ? `\n\nTechnical details:\n${details}` : ''}`;
  }

  if (
    rawLower.includes('permissionerror')
    || rawLower.includes('winerror 32')
    || rawLower.includes('being used by another process')
    || rawLower.includes('output file is locked by another process')
  ) {
    return (
      'Conversion failed: Output files are locked by another program. '
      + 'Close any open section files, folder previews, or editors for the output folder and try again.'
    );
  }

  return `Conversion failed with exit code ${exitCode}.${details ? `\n\n${details}` : ''}`;
}

function loadOutlinePayload(inputPdfPath, outputRootPath) {
  const outputDir = getOutputDirForInput(inputPdfPath, outputRootPath);
  const outlineJsonPath = path.join(outputDir, 'outline.json');
  const outlineMdPath = path.join(outputDir, 'outline.md');

  if (!fs.existsSync(outlineJsonPath)) {
    throw new Error('outline.json not found. Run conversion first.');
  }

  const rawOutlineItems = JSON.parse(fs.readFileSync(outlineJsonPath, 'utf8'));
  const outlineItems = Array.isArray(rawOutlineItems) ? rawOutlineItems.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const sectionRel = String(item.section_file || '').trim();
    if (!sectionRel) return item;
    const fullPath = path.resolve(outputDir, sectionRel);
    const outputRootResolved = path.resolve(outputDir);
    const isInsideOutput = fullPath.startsWith(outputRootResolved);
    const exists = isInsideOutput && fs.existsSync(fullPath);
    if (exists) return item;
    return { ...item, section_file: null };
  }) : [];
  const outlineMarkdown = safeRead(outlineMdPath);

  return {
    outputDir,
    outlineMarkdown,
    outlineItems,
  };
}

function resolveSectionFullPath(inputPdfPath, outputRootPath, sectionRelativePath) {
  const outputDir = getOutputDirForInput(inputPdfPath, outputRootPath);
  const fullPath = path.join(outputDir, sectionRelativePath);
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedFullPath = path.resolve(fullPath);
  if (!resolvedFullPath.startsWith(resolvedOutputDir)) {
    throw new Error('Invalid section path.');
  }
  if (!fs.existsSync(resolvedFullPath)) {
    throw new Error('Section file not found.');
  }
  return resolvedFullPath;
}

function stripSectionMarkdownPreamble(markdownText) {
  const text = String(markdownText || '');
  const markerRegex = /^#{1,6}\s[^\r\n]*\r?\n\r?\n- Level:[^\r\n]*\r?\n- Pages:[^\r\n]*\r?\n- Source:[^\r\n]*\r?\n\r?\n/;
  return text.replace(markerRegex, '');
}

async function readCombinedSectionContent(sectionFullPath) {
  const resolved = path.resolve(sectionFullPath);
  const dir = path.dirname(resolved);
  const fileName = path.basename(resolved);
  const match = fileName.match(/^(.*)-part-(\d+)\.md$/i);
  if (!match) {
    return fsp.readFile(resolved, 'utf8');
  }

  const prefix = match[1];
  const partRegex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-part-(\\d+)\\.md$`, 'i');
  const fileEntries = await fsp.readdir(dir, { withFileTypes: true });
  const partFiles = fileEntries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const m = entry.name.match(partRegex);
      if (!m) return null;
      return { name: entry.name, part: Number.parseInt(m[1], 10) };
    })
    .filter(Boolean)
    .sort((a, b) => a.part - b.part);

  if (partFiles.length <= 1) {
    return fsp.readFile(resolved, 'utf8');
  }

  const contents = [];
  for (let i = 0; i < partFiles.length; i += 1) {
    const partPath = path.join(dir, partFiles[i].name);
    const raw = await fsp.readFile(partPath, 'utf8');
    contents.push(i === 0 ? raw : stripSectionMarkdownPreamble(raw));
  }

  return contents.join('\n\n');
}

function validateInputPdfPath(candidatePath) {
  const raw = String(candidatePath || '').trim();
  if (!raw) {
    return { ok: false, message: 'Input PDF path is missing.' };
  }
  const normalized = path.resolve(raw);
  if (path.extname(normalized).toLowerCase() !== '.pdf') {
    return { ok: false, message: 'Please select a .pdf file.' };
  }
  if (!fs.existsSync(normalized)) {
    return { ok: false, message: 'The selected PDF file could not be found on disk.' };
  }
  return { ok: true, filePath: normalized };
}

function parseDroppedPathCandidate(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  let value = raw
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!value) return '';

  if (/^file:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'file:') return '';
      if (parsed.hostname && parsed.hostname !== 'localhost') return '';
      value = decodeURIComponent(parsed.pathname || '');
      if (!value) return '';
      if (/^\/[A-Za-z]:\//.test(value)) {
        value = value.slice(1);
      }
      value = value.replaceAll('/', path.sep);
    } catch (_err) {
      return '';
    }
  }

  if (/^\/[A-Za-z]:[\\/]/.test(value)) {
    value = value.slice(1);
  }
  if (/^[A-Za-z]:\//.test(value)) {
    value = value.replaceAll('/', path.sep);
  }

  return value;
}

function extractPathLikeTokens(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n|[\u0000]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tokens = [];

  const push = (value) => {
    const v = String(value || '').trim();
    if (v) tokens.push(v);
  };

  for (const line of lines) {
    push(line);
    const quoted = line.match(/"([^"]+\.pdf)"/gi) || [];
    for (const match of quoted) {
      push(match.replace(/^"/, '').replace(/"$/, ''));
    }
    const fileUris = line.match(/file:[^\s]+/gi) || [];
    for (const uri of fileUris) push(uri);
    const winPaths = line.match(/[A-Za-z]:\\[^<>:"|?*\r\n]+\.pdf/gi) || [];
    for (const p of winPaths) push(p);
    const winPathsForward = line.match(/[A-Za-z]:\/[^<>:"|?*\r\n]+\.pdf/gi) || [];
    for (const p of winPathsForward) push(p);
    const slashDrivePaths = line.match(/\/[A-Za-z]:\/[^<>:"|?*\r\n]+\.pdf/gi) || [];
    for (const p of slashDrivePaths) push(p);
  }

  return tokens;
}

function resolveDroppedInputPdf(payload) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    const parsed = parseDroppedPathCandidate(candidate);
    if (parsed && !seen.has(parsed)) {
      seen.add(parsed);
      candidates.push(parsed);
    }
  };

  const fileEntries = Array.isArray(payload?.files) ? payload.files : [];
  for (const item of fileEntries) {
    pushCandidate(item?.path);
    for (const token of extractPathLikeTokens(item?.name)) pushCandidate(token);
  }

  const textByType = payload?.textByType && typeof payload.textByType === 'object' ? payload.textByType : {};
  for (const value of Object.values(textByType)) {
    for (const token of extractPathLikeTokens(value)) {
      pushCandidate(token);
    }
  }

  let sawPdfLikePath = false;
  for (const candidate of candidates) {
    if (String(candidate).toLowerCase().endsWith('.pdf')) {
      sawPdfLikePath = true;
    }
    const check = validateInputPdfPath(candidate);
    if (check.ok) return check;
  }

  if (sawPdfLikePath) {
    return { ok: false, message: 'The selected PDF file could not be found on disk.' };
  }
  return { ok: false, message: 'Please drop a .pdf file.' };
}

ipcMain.handle('pick-pdf', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle('validate-input-pdf', async (_event, candidatePath) => {
  return validateInputPdfPath(candidatePath);
});

ipcMain.handle('resolve-dropped-input-pdf', async (_event, payload) => {
  return resolveDroppedInputPdf(payload);
});

ipcMain.handle('pick-output-dir', async (_event, currentPath) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Output Folder',
    defaultPath: currentPath || getDefaultOutputRoot(),
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, dirPath: result.filePaths[0] };
});

ipcMain.handle('get-default-output-root', async () => {
  const outputRoot = getDefaultOutputRoot();
  ensureDirectoryExists(outputRoot);
  return { outputRoot };
});

ipcMain.handle('get-app-meta', async () => {
  return {
    version: app.getVersion(),
    startedAt: APP_STARTED_AT.toISOString(),
    isPackaged: app.isPackaged,
    title: buildWindowTitle(),
  };
});

ipcMain.handle('run-conversion', async (event, inputPdfPath, outputRootPath, conversionOptions) => {
  const validatedInput = validateInputPdfPath(inputPdfPath);
  if (!validatedInput.ok) {
    throw new Error(validatedInput.message || 'Input PDF path is missing or invalid.');
  }
  const resolvedInputPdfPath = validatedInput.filePath;
  const includeSectionMetadata = conversionOptions?.includeSectionMetadata !== false;
  const outputMode = ['single', 'major', 'sections'].includes(String(conversionOptions?.outputMode || ''))
    ? String(conversionOptions.outputMode)
    : 'sections';

  const scriptPath = path.join(getScriptsDir(), 'phase1.js');
  const outputRoot = normalizeOutputRoot(outputRootPath);
  ensureDirectoryExists(outputRoot);
  const outputDir = getOutputDirForInput(resolvedInputPdfPath, outputRoot);
  const conversionCwd = getConversionCwd();
  const emitProgress = (message) => {
    event.sender.send(CONVERSION_PROGRESS_EVENT, { message: String(message || '') });
  };

  emitProgress('Starting conversion process');
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        '--input', resolvedInputPdfPath,
        '--out-dir', outputRoot,
        '--include-section-metadata', includeSectionMetadata ? '1' : '0',
        '--conversion-mode', outputMode,
      ],
      {
        cwd: conversionCwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let settled = false;
    let timer = null;
    let heartbeat = null;
    let outputBuffer = '';
    const startMs = Date.now();
    let lastProgressAtMs = Date.now();
    let lastProgressMessage = 'starting';

    const readOutputSnapshot = () => {
      let sectionCount = 0;
      let outlineReady = false;
      let latestSectionFile = 'none';
      let latestSectionAgeSec = -1;
      try {
        const candidateDirs = [
          outputDir,
          path.join(outputDir, 'Sections'),
          path.join(outputDir, 'By Major Heading'),
          path.join(outputDir, 'Per Major Headings'),
          // Legacy names (pre-v0.7.0 folder naming)
          path.join(outputDir, 'sections'),
          path.join(outputDir, 'per-major-headings'),
        ];
        const visited = new Set();
        let newestMtimeMs = 0;
        for (const dirPath of candidateDirs) {
          const resolvedDir = path.resolve(dirPath);
          if (visited.has(resolvedDir) || !fs.existsSync(resolvedDir)) continue;
          visited.add(resolvedDir);
          const mdFiles = fs
            .readdirSync(resolvedDir)
            .filter((name) => name.toLowerCase().endsWith('.md'))
            .filter((name) => !(resolvedDir === path.resolve(outputDir) && name.toLowerCase() === 'outline.md'));
          sectionCount += mdFiles.length;
          for (const fileName of mdFiles) {
            const fullPath = path.join(resolvedDir, fileName);
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > newestMtimeMs) {
              newestMtimeMs = stat.mtimeMs;
              latestSectionFile = path.relative(outputDir, fullPath) || fileName;
            }
          }
        }
        if (newestMtimeMs > 0) {
          latestSectionAgeSec = Math.max(0, Math.floor((Date.now() - newestMtimeMs) / 1000));
        }
      } catch (_err) {
        // no-op
      }
      try {
        outlineReady = fs.existsSync(path.join(outputDir, 'outline.json'));
      } catch (_err) {
        // no-op
      }
      return { sectionCount, outlineReady, latestSectionFile, latestSectionAgeSec };
    };

    const parseProgressLine = (rawLine) => {
      const line = String(rawLine || '').trim();
      if (!line) return;
      outputBuffer += `${line}\n`;
      if (outputBuffer.length > 12000) {
        outputBuffer = outputBuffer.slice(-12000);
      }
      if (line.startsWith('PROGRESS:')) {
        lastProgressAtMs = Date.now();
        lastProgressMessage = line.replace(/^PROGRESS:\s*/, '').trim();
        emitProgress(lastProgressMessage);
      }
    };

    const wireStream = (stream) => {
      let pending = '';
      stream.on('data', (chunk) => {
        pending += chunk.toString();
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() || '';
        for (const part of parts) parseProgressLine(part);
      });
      stream.on('end', () => {
        if (pending.trim()) parseProgressLine(pending.trim());
      });
    };

    wireStream(child.stdout);
    wireStream(child.stderr);

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (err) reject(err);
      else resolve();
    };

    child.once('error', (err) => finish(new Error(`Failed to start conversion: ${err.message}`)));
    child.once('exit', (code, signal) => {
      if (signal) {
        finish(new Error(`Conversion terminated by signal: ${signal}`));
        return;
      }
      if (code !== 0) {
        finish(new Error(buildConversionFailureMessage(code, outputBuffer, resolvedInputPdfPath)));
        return;
      }
      finish();
    });

    heartbeat = setInterval(() => {
      if (settled) return;
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      const idleSec = Math.floor((Date.now() - lastProgressAtMs) / 1000);
      const snapshot = readOutputSnapshot();
      const stageSignalsShutdownWait =
        lastProgressMessage.includes('waiting for subprocess exit')
        || lastProgressMessage.includes('Extraction pipeline complete')
        || lastProgressMessage.includes('Core extraction complete');
      const waitingOnlyForExit =
        stageSignalsShutdownWait
        || (
          snapshot.outlineReady
          && snapshot.sectionCount > 0
          && snapshot.latestSectionAgeSec >= 12
          && idleSec >= 12
        );
      const hint = waitingOnlyForExit
        ? 'no active file processing; all written and waiting for Python process exit'
        : 'converter still writing/processing';
      emitProgress(
        `Finalizing converter shutdown; ${hint}; stage="${lastProgressMessage}", sections=${snapshot.sectionCount}, last-written=${snapshot.latestSectionFile} (${snapshot.latestSectionAgeSec}s ago), outline=${snapshot.outlineReady ? 'yes' : 'no'}, last-update=${idleSec}s, elapsed=${elapsedSec}s`
      );
    }, 10_000);

    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (_err) {
        // no-op
      }
      finish(new Error(`Conversion timed out after 10 minutes.${outputBuffer ? `\n\n${outputBuffer}` : ''}`));
    }, 10 * 60 * 1000);
  });

  emitProgress('Loading outline and sections metadata');
  const payload = loadOutlinePayload(resolvedInputPdfPath, outputRoot);
  emitProgress('Conversion complete');
  return payload;
});

ipcMain.handle('open-external-url', async (_event, url) => {
  const target = String(url || '').trim();
  if (!ALLOWED_EXTERNAL_URLS.has(target)) {
    throw new Error('Unsupported external URL.');
  }
  await shell.openExternal(target);
  return { ok: true };
});

ipcMain.handle('load-outline', async (_event, inputPdfPath, outputRootPath) => {
  if (!inputPdfPath || !fs.existsSync(inputPdfPath)) {
    throw new Error('Input PDF path is missing or invalid.');
  }

  return loadOutlinePayload(inputPdfPath, outputRootPath);
});

ipcMain.handle('load-section', async (_event, inputPdfPath, outputRootPath, sectionRelativePath) => {
  const resolvedFullPath = resolveSectionFullPath(inputPdfPath, outputRootPath, sectionRelativePath);
  const content = await readCombinedSectionContent(resolvedFullPath);

  return {
    path: resolvedFullPath,
    content,
  };
});

ipcMain.handle('open-section-in-folder', async (_event, inputPdfPath, outputRootPath, sectionRelativePath) => {
  const resolvedFullPath = resolveSectionFullPath(inputPdfPath, outputRootPath, sectionRelativePath);
  shell.showItemInFolder(resolvedFullPath);
  return { ok: true };
});

ipcMain.handle('open-section-default', async (_event, inputPdfPath, outputRootPath, sectionRelativePath) => {
  const resolvedFullPath = resolveSectionFullPath(inputPdfPath, outputRootPath, sectionRelativePath);
  const openResult = await shell.openPath(resolvedFullPath);
  if (openResult) {
    throw new Error(openResult);
  }
  return { ok: true };
});

ipcMain.handle('copy-section-path', async (_event, inputPdfPath, outputRootPath, sectionRelativePath) => {
  const resolvedFullPath = resolveSectionFullPath(inputPdfPath, outputRootPath, sectionRelativePath);
  clipboard.writeText(resolvedFullPath);
  return { ok: true, path: resolvedFullPath };
});

ipcMain.handle('open-output-dir', async (_event, inputPdfPath, outputRootPath) => {
  const outputRoot = normalizeOutputRoot(outputRootPath);
  ensureDirectoryExists(outputRoot);
  const outputDir = getOutputDirForInput(inputPdfPath, outputRootPath);
  const targetDir = fs.existsSync(outputDir) ? outputDir : outputRoot;
  const openResult = await shell.openPath(targetDir);
  if (openResult) {
    throw new Error(openResult);
  }
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
