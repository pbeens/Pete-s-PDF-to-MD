const state = {
  inputPdfPath: '',
  outputRootPath: '',
  outlineItems: [],
  selectedSection: '',
  currentSectionRaw: '',
  renderMarkdown: false,
  activeConversionRunId: null,
  conversionStatusBase: '',
  conversionStatusTicker: null,
  conversionStartedAt: 0,
};
const RUN_CONVERSION_TIMEOUT_MS = 90 * 1000;
const UI_UNLOCK_WATCHDOG_MS = 45 * 1000;

const pickPdfBtn = document.getElementById('pickPdfBtn');
const runBtn = document.getElementById('runBtn');
const openOutputBtn = document.getElementById('openOutputBtn');
const pickOutputBtn = document.getElementById('pickOutputBtn');
const inputPathEl = document.getElementById('inputPath');
const outputRootPathEl = document.getElementById('outputRootPath');
const statusTextEl = document.getElementById('statusText');
const outlinePreviewEl = document.getElementById('outlinePreview');
const sectionsListEl = document.getElementById('sectionsList');
const sectionPathEl = document.getElementById('sectionPath');
const sectionContentEl = document.getElementById('sectionContent');
const sectionContentRenderedEl = document.getElementById('sectionContentRendered');
const renderMarkdownChk = document.getElementById('renderMarkdownChk');
const buildStampEl = document.getElementById('buildStamp');
const mainLayoutEl = document.getElementById('mainLayout');
const outlinePanelEl = document.getElementById('outlinePanel');
const toggleOutlineBtn = document.getElementById('toggleOutlineBtn');
let unsubscribeConversionProgress = null;
const OUTLINE_COLLAPSE_KEY = 'pdf_to_md_outline_collapsed';
const RENDER_MARKDOWN_KEY = 'pdf_to_md_render_markdown';

function setStatus(text) {
  statusTextEl.textContent = text;
}

function compactPath(fullPath, maxChars = 56) {
  const value = String(fullPath || '');
  if (!value) return '(none)';
  if (value.length <= maxChars) return value;
  const side = Math.max(10, Math.floor((maxChars - 3) / 2));
  return `${value.slice(0, side)}...${value.slice(-side)}`;
}

function renderPathDisplays() {
  const inputFull = state.inputPdfPath || '(none)';
  const outputFull = state.outputRootPath || '(default)';
  inputPathEl.textContent = compactPath(inputFull, 54);
  outputRootPathEl.textContent = compactPath(outputFull, 50);
  inputPathEl.title = inputFull;
  outputRootPathEl.title = outputFull;
}

function renderSectionPathDisplay(fullPath) {
  const text = String(fullPath || '');
  sectionPathEl.textContent = text ? compactPath(text, 68) : '';
  sectionPathEl.title = text;
}

function setOutlineCollapsed(collapsed) {
  if (!mainLayoutEl || !outlinePanelEl || !toggleOutlineBtn) return;
  mainLayoutEl.classList.toggle('outline-collapsed', collapsed);
  outlinePanelEl.classList.toggle('collapsed', collapsed);
  toggleOutlineBtn.textContent = collapsed ? 'Expand' : 'Collapse';
  toggleOutlineBtn.title = collapsed ? 'Expand outline panel' : 'Collapse outline panel';
}

function renderConversionStatus() {
  if (!state.activeConversionRunId) return;
  const elapsedSec = Math.max(0, Math.floor((Date.now() - state.conversionStartedAt) / 1000));
  const base = state.conversionStatusBase || 'Working...';
  setStatus(`Running conversion: ${base} (${elapsedSec}s elapsed)`);
}

function startConversionStatus(baseMessage) {
  state.conversionStatusBase = baseMessage;
  state.conversionStartedAt = Date.now();
  if (state.conversionStatusTicker) {
    clearInterval(state.conversionStatusTicker);
  }
  renderConversionStatus();
  state.conversionStatusTicker = setInterval(renderConversionStatus, 1000);
}

function updateConversionStatus(baseMessage) {
  state.conversionStatusBase = baseMessage;
  renderConversionStatus();
}

function stopConversionStatus() {
  if (state.conversionStatusTicker) {
    clearInterval(state.conversionStatusTicker);
    state.conversionStatusTicker = null;
  }
  state.conversionStatusBase = '';
  state.conversionStartedAt = 0;
}

function setBusy(busy) {
  runBtn.disabled = busy || !state.inputPdfPath;
  pickPdfBtn.disabled = busy;
  pickOutputBtn.disabled = busy;
  openOutputBtn.disabled = busy || !state.inputPdfPath;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markdownToBasicHtml(markdownText) {
  const lines = String(markdownText || '').split('\n');
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const splitTableCells = (line) => {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((cell) => escapeHtml(cell.trim()));
  };

  const isTableSeparator = (line) => {
    const cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    if (!cleaned.includes('-')) return false;
    return cleaned
      .split('|')
      .every((part) => /^:?-{3,}:?$/.test(part.trim()));
  };

  const isListItemLine = (text) => /^\s*[-*]\s+/.test(text);
  const isIndentedContinuation = (text) => /^\s{2,}\S/.test(text) || /^\t+\S/.test(text);
  const isHeadingLine = (text) => /^(#{1,6})\s+/.test(text.trim());

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx].trimEnd();
    const nextLine = idx + 1 < lines.length ? lines[idx + 1].trimEnd() : '';
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);

    if (!line.trim()) {
      // Keep list open across blank lines so list items don't become isolated blocks.
      continue;
    }

    if (headingMatch) {
      closeList();
      const level = Math.min(6, headingMatch[1].length);
      out.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    const looksLikeTableRow = line.includes('|');
    if (looksLikeTableRow && isTableSeparator(nextLine)) {
      closeList();
      const headerCells = splitTableCells(line);
      idx += 2;
      const bodyRows = [];
      while (idx < lines.length) {
        const rowLine = lines[idx].trimEnd();
        if (!rowLine.trim() || !rowLine.includes('|')) {
          idx -= 1;
          break;
        }
        bodyRows.push(splitTableCells(rowLine));
        idx += 1;
      }

      out.push('<table><thead><tr>');
      for (const cell of headerCells) out.push(`<th>${cell}</th>`);
      out.push('</tr></thead><tbody>');
      for (const rowCells of bodyRows) {
        out.push('<tr>');
        for (const cell of rowCells) out.push(`<td>${cell}</td>`);
        out.push('</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    if (listMatch) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const itemParts = [listMatch[1].trim()];
      while (idx + 1 < lines.length) {
        const probe = lines[idx + 1];
        const probeTrimmed = probe.trim();
        if (!probeTrimmed) {
          break;
        }
        if (isListItemLine(probe) || isHeadingLine(probeTrimmed)) {
          break;
        }
        if (probe.includes('|') && isTableSeparator(lines[idx + 2] ? lines[idx + 2].trimEnd() : '')) {
          break;
        }
        if (!isIndentedContinuation(probe)) {
          break;
        }
        itemParts.push(probeTrimmed);
        idx += 1;
      }
      out.push(`<li>${escapeHtml(itemParts.join(' '))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${escapeHtml(line.trim())}</p>`);
  }
  closeList();
  return out.join('\n');
}

function renderSectionContentView() {
  const text = state.currentSectionRaw || '';
  sectionContentEl.textContent = text;

  if (state.renderMarkdown) {
    sectionContentRenderedEl.hidden = false;
    sectionContentEl.hidden = true;
    sectionContentRenderedEl.innerHTML = markdownToBasicHtml(text);
  } else {
    sectionContentRenderedEl.hidden = true;
    sectionContentEl.hidden = false;
    sectionContentRenderedEl.innerHTML = '';
  }
}

function sectionBaseLevel() {
  const levels = state.outlineItems
    .filter((item) => item.section_file)
    .map((item) => Number(item.level))
    .filter((n) => Number.isFinite(n));
  return levels.length ? Math.min(...levels) : 1;
}

function updateSectionSelectionUI() {
  const buttons = sectionsListEl.querySelectorAll('button[data-section-file]');
  for (const btn of buttons) {
    const sectionFile = btn.dataset.sectionFile || '';
    btn.classList.toggle('active', sectionFile === state.selectedSection);
  }
}

function renderSectionsList() {
  sectionsListEl.innerHTML = '';
  const baseLevel = sectionBaseLevel();
  for (const item of state.outlineItems) {
    if (!item.section_file) continue;

    const li = document.createElement('li');
    const btn = document.createElement('button');
    const depth = Math.max(1, Math.min(4, Number(item.level) - baseLevel + 1));
    btn.classList.add(`depth-${depth}`);
    btn.dataset.sectionFile = item.section_file;
    btn.addEventListener('click', () => {
      state.selectedSection = item.section_file;
      updateSectionSelectionUI();
      void loadSection(item.section_file);
    });

    const title = document.createElement('span');
    title.className = 'section-title';
    title.textContent = item.title;

    btn.appendChild(title);

    li.appendChild(btn);
    sectionsListEl.appendChild(li);
  }
  updateSectionSelectionUI();
}

async function loadSection(sectionRelativePath) {
  if (!state.inputPdfPath || !sectionRelativePath) return;
  try {
    setStatus('Loading section...');
    const payload = await withTimeout(
      window.pdfToMdApi.loadSection(state.inputPdfPath, state.outputRootPath, sectionRelativePath),
      30_000,
      'Loading section'
    );
    state.selectedSection = sectionRelativePath;
    state.currentSectionRaw = payload.content || '';
    renderSectionPathDisplay(payload.path);
    renderSectionContentView();
    updateSectionSelectionUI();
    setStatus('Ready');
  } catch (err) {
    setStatus('Error');
    state.currentSectionRaw = String(err.message || err);
    renderSectionContentView();
  }
}

async function refreshOutline() {
  if (!state.inputPdfPath) return;
  const payload = await window.pdfToMdApi.loadOutline(state.inputPdfPath, state.outputRootPath);
  state.outlineItems = payload.outlineItems || [];
  if (payload.outlineMarkdown && payload.outlineMarkdown.trim()) {
    outlinePreviewEl.textContent = payload.outlineMarkdown;
  } else {
    outlinePreviewEl.textContent = state.outlineItems
      .map((x) => `L${x.level} p${x.page_start} ${x.title}`)
      .join('\\n');
  }

  const firstSection = state.outlineItems.find((x) => x.section_file)?.section_file || '';
  state.selectedSection = firstSection;
  renderSectionsList();

  if (!firstSection) {
    renderSectionPathDisplay('');
    state.currentSectionRaw = 'No section files available for this conversion result.';
  } else {
    renderSectionPathDisplay('');
    state.currentSectionRaw = 'Select a section to preview content.';
  }
  renderSectionContentView();
  setStatus('Ready');
}

pickPdfBtn.addEventListener('click', async () => {
  try {
    setBusy(true);
    setStatus('Selecting PDF...');
    const result = await window.pdfToMdApi.pickPdf();
    if (result?.canceled) {
      setStatus('Idle');
      return;
    }
    state.inputPdfPath = result.filePath;
    renderPathDisplays();
    setStatus('PDF selected');
    runBtn.disabled = false;
    openOutputBtn.disabled = false;
  } catch (err) {
    setStatus('Error');
    alert(`Failed to select PDF: ${err.message || err}`);
  } finally {
    setBusy(false);
  }
});

runBtn.addEventListener('click', async () => {
  if (!state.inputPdfPath) return;
  if (state.activeConversionRunId) return;
  const runId = Date.now();
  state.activeConversionRunId = runId;
  let watchdog = null;
  setBusy(true);
  startConversionStatus('Initializing conversion. Large PDFs can take a few minutes.');
  watchdog = setTimeout(() => {
    if (state.activeConversionRunId !== runId) return;
    updateConversionStatus('Still processing. Large PDFs may take several minutes; waiting for conversion to finish.');
  }, UI_UNLOCK_WATCHDOG_MS);

  void withTimeout(
    window.pdfToMdApi.runConversion(state.inputPdfPath, state.outputRootPath),
    RUN_CONVERSION_TIMEOUT_MS,
    'Running conversion'
  ).then((payload) => {
    if (state.activeConversionRunId !== runId) return;
    state.outlineItems = payload.outlineItems || [];
    if (payload.outlineMarkdown && payload.outlineMarkdown.trim()) {
      outlinePreviewEl.textContent = payload.outlineMarkdown;
    } else {
      outlinePreviewEl.textContent = state.outlineItems
        .map((x) => `L${x.level} p${x.page_start} ${x.title}`)
        .join('\\n');
    }
    const firstSection = state.outlineItems.find((x) => x.section_file)?.section_file || '';
    state.selectedSection = firstSection;
    renderSectionsList();
    if (!firstSection) {
      renderSectionPathDisplay('');
      state.currentSectionRaw = 'No section files available for this conversion result.';
    } else {
      renderSectionPathDisplay('');
      state.currentSectionRaw = 'Conversion complete. Select a section to preview content.';
    }
    renderSectionContentView();
    setStatus('Conversion complete');
  }).catch((err) => {
    if (state.activeConversionRunId !== runId) return;
    const message = String(err?.message || err || '');
    if (message.includes('Running conversion timed out')) {
      stopConversionStatus();
      setStatus('Conversion timed out. Attempting to load latest output...');
      void refreshOutline().then(() => {
        setStatus('Loaded latest available output after timeout');
      }).catch(() => {
        setStatus('Conversion timed out and no output was found.');
      });
    } else {
      setStatus('Error');
      alert(`Conversion failed: ${message}`);
    }
  }).finally(() => {
    if (watchdog) {
      clearTimeout(watchdog);
    }
    if (state.activeConversionRunId === runId) {
      state.activeConversionRunId = null;
      stopConversionStatus();
      setBusy(false);
    }
  });
});

openOutputBtn.addEventListener('click', async () => {
  if (!state.inputPdfPath) return;
  try {
    await window.pdfToMdApi.openOutputDir(state.inputPdfPath, state.outputRootPath);
  } catch (err) {
    alert(`Could not open output folder: ${err.message || err}`);
  }
});

pickOutputBtn.addEventListener('click', async () => {
  try {
    setBusy(true);
    setStatus('Selecting output folder...');
    const result = await window.pdfToMdApi.pickOutputDir(state.outputRootPath);
    if (!result?.canceled && result?.dirPath) {
      state.outputRootPath = result.dirPath;
      renderPathDisplays();
      setStatus('Output folder updated');
    } else {
      setStatus('Ready');
    }
  } catch (err) {
    setStatus('Error');
    alert(`Failed to pick output folder: ${err.message || err}`);
  } finally {
    setBusy(false);
  }
});

if (toggleOutlineBtn) {
  toggleOutlineBtn.addEventListener('click', () => {
    const collapsed = !mainLayoutEl?.classList.contains('outline-collapsed');
    setOutlineCollapsed(Boolean(collapsed));
    try {
      localStorage.setItem(OUTLINE_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (_err) {
      // no-op
    }
  });
}

if (renderMarkdownChk) {
  renderMarkdownChk.addEventListener('change', () => {
    state.renderMarkdown = Boolean(renderMarkdownChk.checked);
    renderSectionContentView();
    try {
      localStorage.setItem(RENDER_MARKDOWN_KEY, state.renderMarkdown ? '1' : '0');
    } catch (_err) {
      // no-op
    }
  });
}

(async function boot() {
  try {
    try {
      const saved = localStorage.getItem(OUTLINE_COLLAPSE_KEY);
      setOutlineCollapsed(saved === '1');
    } catch (_err) {
      setOutlineCollapsed(false);
    }

    try {
      const savedRender = localStorage.getItem(RENDER_MARKDOWN_KEY);
      state.renderMarkdown = savedRender === '1';
    } catch (_err) {
      state.renderMarkdown = false;
    }
    if (renderMarkdownChk) {
      renderMarkdownChk.checked = state.renderMarkdown;
    }

    if (typeof window.pdfToMdApi.onConversionProgress === 'function') {
      unsubscribeConversionProgress = window.pdfToMdApi.onConversionProgress((payload) => {
        if (!state.activeConversionRunId) return;
        const message = String(payload?.message || '').trim();
        if (!message) return;
        updateConversionStatus(message);
      });
    }

    const appMeta = await window.pdfToMdApi.getAppMeta();
    if (appMeta?.title) {
      document.title = appMeta.title;
    }
    if (buildStampEl) {
      buildStampEl.textContent = `Build: v${appMeta?.version || '?'} | ${appMeta?.startedAt || 'unknown'}`;
    }

    const defaults = await window.pdfToMdApi.getDefaultOutputRoot();
    state.outputRootPath = defaults.outputRoot || '';
    renderPathDisplays();
  } catch (_err) {
    if (buildStampEl) {
      buildStampEl.textContent = 'Build: unavailable';
    }
    renderPathDisplays();
  }
  setStatus('Idle');
  outlinePreviewEl.textContent = 'Select a PDF and click Run Conversion.';
  state.currentSectionRaw = 'Section content will appear here.';
  renderSectionContentView();
})();

window.addEventListener('beforeunload', () => {
  stopConversionStatus();
  if (typeof unsubscribeConversionProgress === 'function') {
    unsubscribeConversionProgress();
    unsubscribeConversionProgress = null;
  }
});
