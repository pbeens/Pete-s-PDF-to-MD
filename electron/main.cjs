const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT_DIR, 'output');
const APP_STARTED_AT = new Date();
const CONVERSION_PROGRESS_EVENT = 'conversion-progress';

function buildWindowTitle() {
  const launchedAt = APP_STARTED_AT.toISOString();
  return `Pete's PDF to MD v${app.getVersion()} | ${launchedAt}`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: buildWindowTitle(),
  });

  win.loadFile(path.join(ROOT_DIR, 'app', 'index.html'));
}

function normalizeOutputRoot(outputRootPath) {
  if (!outputRootPath) {
    return OUTPUT_ROOT;
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

function loadOutlinePayload(inputPdfPath, outputRootPath) {
  const outputDir = getOutputDirForInput(inputPdfPath, outputRootPath);
  const outlineJsonPath = path.join(outputDir, 'outline.json');
  const outlineMdPath = path.join(outputDir, 'outline.md');

  if (!fs.existsSync(outlineJsonPath)) {
    throw new Error('outline.json not found. Run conversion first.');
  }

  const outlineItems = JSON.parse(fs.readFileSync(outlineJsonPath, 'utf8'));
  const outlineMarkdown = safeRead(outlineMdPath);

  return {
    outputDir,
    outlineMarkdown,
    outlineItems,
  };
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

ipcMain.handle('pick-output-dir', async (_event, currentPath) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Output Folder',
    defaultPath: currentPath || OUTPUT_ROOT,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, dirPath: result.filePaths[0] };
});

ipcMain.handle('get-default-output-root', async () => {
  return { outputRoot: OUTPUT_ROOT };
});

ipcMain.handle('get-app-meta', async () => {
  return {
    version: app.getVersion(),
    startedAt: APP_STARTED_AT.toISOString(),
    title: buildWindowTitle(),
  };
});

ipcMain.handle('run-conversion', async (event, inputPdfPath, outputRootPath) => {
  if (!inputPdfPath || !fs.existsSync(inputPdfPath)) {
    throw new Error('Input PDF path is missing or invalid.');
  }

  const scriptPath = path.join(ROOT_DIR, 'scripts', 'phase1.js');
  const outputRoot = normalizeOutputRoot(outputRootPath);
  const outputDir = getOutputDirForInput(inputPdfPath, outputRoot);
  const emitProgress = (message) => {
    event.sender.send(CONVERSION_PROGRESS_EVENT, { message: String(message || '') });
  };

  emitProgress('Starting conversion process');
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, '--input', inputPdfPath, '--out-dir', outputRoot],
      {
        cwd: ROOT_DIR,
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
        const sectionsDir = path.join(outputDir, 'sections');
        if (fs.existsSync(sectionsDir)) {
          const mdFiles = fs.readdirSync(sectionsDir).filter((name) => name.toLowerCase().endsWith('.md'));
          sectionCount = mdFiles.length;
          let newestMtimeMs = 0;
          for (const fileName of mdFiles) {
            const fullPath = path.join(sectionsDir, fileName);
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > newestMtimeMs) {
              newestMtimeMs = stat.mtimeMs;
              latestSectionFile = fileName;
            }
          }
          if (newestMtimeMs > 0) {
            latestSectionAgeSec = Math.max(0, Math.floor((Date.now() - newestMtimeMs) / 1000));
          }
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
        finish(new Error(`Conversion failed with exit code ${code}.${outputBuffer ? `\n\n${outputBuffer}` : ''}`));
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
  const payload = loadOutlinePayload(inputPdfPath, outputRoot);
  emitProgress('Conversion complete');
  return payload;
});

ipcMain.handle('load-outline', async (_event, inputPdfPath, outputRootPath) => {
  if (!inputPdfPath || !fs.existsSync(inputPdfPath)) {
    throw new Error('Input PDF path is missing or invalid.');
  }

  return loadOutlinePayload(inputPdfPath, outputRootPath);
});

ipcMain.handle('load-section', async (_event, inputPdfPath, outputRootPath, sectionRelativePath) => {
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

  return {
    path: resolvedFullPath,
    content: await fsp.readFile(resolvedFullPath, 'utf8'),
  };
});

ipcMain.handle('open-output-dir', async (_event, inputPdfPath, outputRootPath) => {
  const outputDir = getOutputDirForInput(inputPdfPath, outputRootPath);
  if (!fs.existsSync(outputDir)) {
    throw new Error('Output directory not found.');
  }
  await shell.openPath(outputDir);
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
