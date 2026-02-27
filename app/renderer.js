const state = {
  inputPdfPath: '',
  outputRootPath: '',
  currentSectionPath: '',
  outlineItems: [],
  selectedSection: '',
  currentSectionRaw: '',
  renderMarkdown: false,
  hideSectionMetaInPreview: false,
  includeSectionMetaInFiles: true,
  conversionDirty: false,
  activeConversionRunId: null,
  conversionStatusBase: '',
  conversionStatusTicker: null,
  conversionStartedAt: 0,
};
const RUN_CONVERSION_TIMEOUT_MS = 90 * 1000;
const UI_UNLOCK_WATCHDOG_MS = 45 * 1000;
const SECTION_METADATA_BLOCK_REGEX = /\r?\n\r?\n- Level:[^\r\n]*\r?\n- Pages:[^\r\n]*\r?\n- Source:[^\r\n]*\r?\n\r?\n/;

const pickPdfBtn = document.getElementById('pickPdfBtn');
const runBtn = document.getElementById('runBtn');
const openOutputBtn = document.getElementById('openOutputBtn');
const pickOutputBtn = document.getElementById('pickOutputBtn');
const supportMenuWrapEl = document.getElementById('supportMenuWrap');
const supportMenuBtn = document.getElementById('supportMenuBtn');
const supportMenuEl = document.getElementById('supportMenu');
const aboutBtn = document.getElementById('aboutBtn');
const aboutDialog = document.getElementById('aboutDialog');
const openRepoBtn = document.getElementById('openRepoBtn');
const aboutBuyCoffeeBtn = document.getElementById('aboutBuyCoffeeBtn');
const reportBugBtn = document.getElementById('reportBugBtn');
const buyCoffeeBtn = document.getElementById('buyCoffeeBtn');
const inputPathEl = document.getElementById('inputPath');
const outputRootPathEl = document.getElementById('outputRootPath');
const statusTextEl = document.getElementById('statusText');
const outlinePreviewEl = document.getElementById('outlinePreview');
const sectionsListEl = document.getElementById('sectionsList');
const sectionPathEl = document.getElementById('sectionPath');
const sectionContentEl = document.getElementById('sectionContent');
const sectionContentRenderedEl = document.getElementById('sectionContentRendered');
const renderMarkdownChk = document.getElementById('renderMarkdownChk');
const hideSectionMetaChk = document.getElementById('hideSectionMetaChk');
const includeSectionMetaChk = document.getElementById('includeSectionMetaChk');
const buildStampEl = document.getElementById('buildStamp');
const mainLayoutEl = document.getElementById('mainLayout');
const outlinePanelEl = document.getElementById('outlinePanel');
const toggleOutlineBtn = document.getElementById('toggleOutlineBtn');
const inputDropZoneEl = pickPdfBtn;
let unsubscribeConversionProgress = null;
let sectionContextMenuEl = null;
let sectionContextTarget = '';
const OUTLINE_COLLAPSE_KEY = 'pdf_to_md_outline_collapsed';
const RENDER_MARKDOWN_KEY = 'pdf_to_md_render_markdown';
const HIDE_SECTION_META_PREVIEW_KEY = 'pdf_to_md_hide_section_meta_preview';
const INCLUDE_SECTION_META_FILES_KEY = 'pdf_to_md_include_section_meta_files';
const ISSUES_URL = 'https://github.com/pbeens/Pete-s-PDF-to-MD/issues';
const BUY_COFFEE_URL = 'https://buymeacoffee.com/pbeens';
const REPO_URL = 'https://github.com/pbeens/Pete-s-PDF-to-MD';

function setStatus(text) {
  statusTextEl.textContent = text;
}

function closeSupportMenu() {
  if (!supportMenuEl || !supportMenuBtn) return;
  supportMenuEl.hidden = true;
  supportMenuBtn.setAttribute('aria-expanded', 'false');
}

function toggleSupportMenu() {
  if (!supportMenuEl || !supportMenuBtn) return;
  const opening = Boolean(supportMenuEl.hidden);
  supportMenuEl.hidden = !opening;
  supportMenuBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

let pathMeasureCanvas = null;

function measureTextWidth(text, element) {
  if (!pathMeasureCanvas) {
    pathMeasureCanvas = document.createElement('canvas');
  }
  const ctx = pathMeasureCanvas.getContext('2d');
  const style = window.getComputedStyle(element);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return ctx.measureText(String(text || '')).width;
}

function splitPathParts(pathValue) {
  const value = String(pathValue || '');
  const sep = value.includes('\\') ? '\\' : '/';
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return { value, sep, parts };
}

function middleEllipsizePath(fullPath, element) {
  const value = String(fullPath || '');
  if (!value) return '';
  const availableWidth = Math.max(0, Math.floor(element.clientWidth || element.offsetWidth || 0));
  if (!availableWidth || measureTextWidth(value, element) <= availableWidth) {
    return value;
  }

  const { sep, parts } = splitPathParts(value);
  if (parts.length <= 1) return value;

  const endSegment = parts[parts.length - 1];
  const startParts = parts.length >= 2 ? parts.slice(0, 2) : parts.slice(0, 1);
  const startSegment = startParts.join(sep);
  const minimal = `${startSegment}${sep}...${sep}${endSegment}`;

  // Preserve file/folder name in full; if width is still too small, allow CSS clipping.
  return minimal;
}

function renderPathDisplays() {
  const inputFull = state.inputPdfPath || '(none)';
  const outputFull = state.outputRootPath || '(default)';
  inputPathEl.textContent = middleEllipsizePath(inputFull, inputPathEl);
  outputRootPathEl.textContent = middleEllipsizePath(outputFull, outputRootPathEl);
  inputPathEl.title = inputFull;
  outputRootPathEl.title = outputFull;
}

function renderSectionPathDisplay(fullPath) {
  const text = String(fullPath || '');
  state.currentSectionPath = text;
  sectionPathEl.textContent = text ? middleEllipsizePath(text, sectionPathEl) : '';
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

function updateRunButtonState() {
  const busy = Boolean(state.activeConversionRunId);
  const canRun = !busy && Boolean(state.inputPdfPath) && Boolean(state.conversionDirty);
  runBtn.disabled = !canRun;
  runBtn.classList.toggle('up-to-date', !busy && Boolean(state.inputPdfPath) && !state.conversionDirty);
  runBtn.textContent = state.conversionDirty ? 'Run Conversion' : 'Up to Date';
}

function markConversionDirty(reasonStatus) {
  state.conversionDirty = true;
  updateRunButtonState();
  if (reasonStatus) {
    setStatus(reasonStatus);
  }
}

function markConversionClean() {
  state.conversionDirty = false;
  updateRunButtonState();
}

function setBusy(busy) {
  pickPdfBtn.disabled = busy;
  pickOutputBtn.disabled = busy;
  openOutputBtn.disabled = busy || !state.inputPdfPath;
  updateRunButtonState();
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function toUserErrorMessage(err, fallback = 'An unexpected error occurred.') {
  let message = String(err?.message || err || '').trim();
  if (!message) return fallback;

  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '');

  const technicalBlock = message.match(/\n\s*(Technical details:|Traceback \(most recent call last\):|PROGRESS:)/i);
  if (technicalBlock && Number.isInteger(technicalBlock.index) && technicalBlock.index > 0) {
    message = message.slice(0, technicalBlock.index).trim();
  }

  if (message.length > 420) {
    message = `${message.slice(0, 417).trimEnd()}...`;
  }

  return message || fallback;
}

function formatLocalDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'unknown';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function setInputPdfPath(filePath, options = {}) {
  const forceDirty = Boolean(options.forceDirty);
  const nextPath = String(filePath || '');
  const changed = nextPath !== state.inputPdfPath;
  state.inputPdfPath = nextPath;
  renderPathDisplays();
  openOutputBtn.disabled = !state.inputPdfPath;
  if (!state.inputPdfPath) {
    markConversionClean();
  } else if (changed || forceDirty) {
    markConversionDirty('PDF selected');
  } else {
    updateRunButtonState();
  }
}

function getDropPayload(event) {
  const files = Array.from(event?.dataTransfer?.files || []).map((file) => {
    const nativePath = typeof window.pdfToMdApi?.getPathForFile === 'function'
      ? window.pdfToMdApi.getPathForFile(file)
      : '';
    return {
      name: String(file?.name || ''),
      path: String(file?.path || nativePath || ''),
    };
  });
  const dataTransfer = event?.dataTransfer;
  const types = Array.from(dataTransfer?.types || []).map((t) => String(t || ''));
  const textByType = {};
  for (const type of types) {
    try {
      textByType[type] = String(dataTransfer?.getData(type) || '');
    } catch (_err) {
      // no-op
    }
  }
  return { files, types, textByType };
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAllowSup(text) {
  const source = String(text || '');
  const superscripts = [];
  const tokenized = source.replace(/<sup>\s*(\d{1,3})\s*<\/sup>/gi, (_m, num) => {
    const idx = superscripts.length;
    superscripts.push(String(num));
    return `@@SUP_TOKEN_${idx}@@`;
  });

  let escaped = escapeHtml(tokenized);
  for (let i = 0; i < superscripts.length; i += 1) {
    escaped = escaped.replace(`@@SUP_TOKEN_${i}@@`, `<sup>${superscripts[i]}</sup>`);
  }
  return escaped;
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
    return trimmed.split('|').map((cell) => escapeHtmlAllowSup(cell.trim()));
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
      out.push(`<h${level}>${escapeHtmlAllowSup(headingMatch[2])}</h${level}>`);
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
      out.push(`<li>${escapeHtmlAllowSup(itemParts.join(' '))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${escapeHtmlAllowSup(line.trim())}</p>`);
  }
  closeList();
  return out.join('\n');
}

function renderSectionContentView() {
  const raw = state.currentSectionRaw || '';
  const text = state.hideSectionMetaInPreview ? stripSectionMetadataHeader(raw) : raw;
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
      closeSectionContextMenu();
      void loadSection(item.section_file);
    });
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSectionContextMenu(event.clientX, event.clientY, item.section_file);
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

function stripSectionMetadataHeader(markdownText) {
  const text = String(markdownText || '');
  return text.replace(SECTION_METADATA_BLOCK_REGEX, '\n\n');
}

function sectionHasMetadataHeader(markdownText) {
  return SECTION_METADATA_BLOCK_REGEX.test(String(markdownText || ''));
}

function updateHideMetaControlState() {
  if (!hideSectionMetaChk) return;
  const available = sectionHasMetadataHeader(state.currentSectionRaw || '');
  hideSectionMetaChk.disabled = !available;
  if (!available && state.hideSectionMetaInPreview) {
    state.hideSectionMetaInPreview = false;
    hideSectionMetaChk.checked = false;
  }
}

function ensureSectionContextMenu() {
  if (sectionContextMenuEl) return sectionContextMenuEl;
  const menu = document.createElement('div');
  menu.id = 'sectionContextMenu';
  menu.className = 'section-context-menu';
  menu.hidden = true;

  const openFolderBtn = document.createElement('button');
  openFolderBtn.type = 'button';
  openFolderBtn.textContent = 'Open in folder';
  openFolderBtn.addEventListener('click', async () => {
    const target = sectionContextTarget;
    closeSectionContextMenu();
    if (!target || !state.inputPdfPath) return;
    try {
      await window.pdfToMdApi.openSectionInFolder(state.inputPdfPath, state.outputRootPath, target);
    } catch (err) {
      alert(`Could not open folder: ${toUserErrorMessage(err, 'Could not open folder.')}`);
    }
  });

  const openDefaultBtn = document.createElement('button');
  openDefaultBtn.type = 'button';
  openDefaultBtn.textContent = 'Open in default program';
  openDefaultBtn.addEventListener('click', async () => {
    const target = sectionContextTarget;
    closeSectionContextMenu();
    if (!target || !state.inputPdfPath) return;
    try {
      await window.pdfToMdApi.openSectionDefault(state.inputPdfPath, state.outputRootPath, target);
    } catch (err) {
      alert(`Could not open file: ${toUserErrorMessage(err, 'Could not open file.')}`);
    }
  });

  const copyPathBtn = document.createElement('button');
  copyPathBtn.type = 'button';
  copyPathBtn.textContent = 'Copy path';
  copyPathBtn.addEventListener('click', async () => {
    const target = sectionContextTarget;
    closeSectionContextMenu();
    if (!target || !state.inputPdfPath) return;
    try {
      const result = await window.pdfToMdApi.copySectionPath(state.inputPdfPath, state.outputRootPath, target);
      if (result?.ok) {
        setStatus('Section path copied');
      }
    } catch (err) {
      alert(`Could not copy path: ${toUserErrorMessage(err, 'Could not copy path.')}`);
    }
  });

  menu.appendChild(openFolderBtn);
  menu.appendChild(openDefaultBtn);
  menu.appendChild(copyPathBtn);
  document.body.appendChild(menu);
  sectionContextMenuEl = menu;
  return menu;
}

function closeSectionContextMenu() {
  if (!sectionContextMenuEl) return;
  sectionContextMenuEl.hidden = true;
  sectionContextTarget = '';
}

function showSectionContextMenu(clientX, clientY, sectionFile) {
  const menu = ensureSectionContextMenu();
  sectionContextTarget = sectionFile;
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';

  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(8, window.innerHeight - rect.height - 8);
  const left = Math.min(Math.max(8, clientX), maxX);
  const top = Math.min(Math.max(8, clientY), maxY);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
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
    updateHideMetaControlState();
    renderSectionContentView();
    sectionContentEl.scrollTop = 0;
    sectionContentRenderedEl.scrollTop = 0;
    updateSectionSelectionUI();
    setStatus('Ready');
  } catch (err) {
    setStatus('Error');
    state.currentSectionRaw = String(err.message || err);
    updateHideMetaControlState();
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
  updateHideMetaControlState();
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
    setInputPdfPath(result.filePath, { forceDirty: true });
    setStatus('PDF selected');
  } catch (err) {
    setStatus('Error');
    alert(`Failed to select PDF: ${toUserErrorMessage(err, 'Could not select a PDF file.')}`);
  } finally {
    setBusy(false);
  }
});

if (inputDropZoneEl) {
  inputDropZoneEl.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (!state.activeConversionRunId) {
      inputDropZoneEl.classList.add('drag-active');
      setStatus('Drop PDF on Select PDF button');
    }
  });

  inputDropZoneEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = state.activeConversionRunId ? 'none' : 'copy';
  });

  inputDropZoneEl.addEventListener('dragleave', () => {
    inputDropZoneEl.classList.remove('drag-active');
    if (!state.activeConversionRunId) {
      setStatus(state.inputPdfPath ? 'PDF selected' : 'Idle');
    }
  });

  inputDropZoneEl.addEventListener('drop', async (event) => {
    event.preventDefault();
    inputDropZoneEl.classList.remove('drag-active');

    if (state.activeConversionRunId) {
      setStatus('Conversion in progress. Wait for completion before changing input.');
      return;
    }

    const dropPayload = getDropPayload(event);
    const validation = await window.pdfToMdApi.resolveDroppedInputPdf(dropPayload);
    if (!validation?.ok || !validation?.filePath) {
      setStatus('Error');
      alert(toUserErrorMessage(validation?.message || 'Dropped file path is invalid.'));
      return;
    }

    setInputPdfPath(validation.filePath, { forceDirty: true });
    setStatus('PDF selected');
  });
}

window.addEventListener('dragover', (event) => {
  event.preventDefault();
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
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
    window.pdfToMdApi.runConversion(state.inputPdfPath, state.outputRootPath, {
      includeSectionMetadata: state.includeSectionMetaInFiles,
    }),
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
    markConversionClean();
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
      console.error('Conversion failed (full details):', err);
      alert(`Conversion failed: ${toUserErrorMessage(err, 'Conversion failed.')}`);
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
    alert(`Could not open output folder: ${toUserErrorMessage(err, 'Could not open output folder.')}`);
  }
});

pickOutputBtn.addEventListener('click', async () => {
  try {
    setBusy(true);
    setStatus('Selecting output folder...');
    const result = await window.pdfToMdApi.pickOutputDir(state.outputRootPath);
    if (!result?.canceled && result?.dirPath) {
      const changed = String(result.dirPath) !== String(state.outputRootPath);
      state.outputRootPath = result.dirPath;
      renderPathDisplays();
      if (changed) {
        markConversionDirty('Output folder updated');
      } else {
        setStatus('Ready');
      }
    } else {
      setStatus('Ready');
    }
  } catch (err) {
    setStatus('Error');
    alert(`Failed to pick output folder: ${toUserErrorMessage(err, 'Could not select an output folder.')}`);
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

if (hideSectionMetaChk) {
  hideSectionMetaChk.addEventListener('change', () => {
    state.hideSectionMetaInPreview = Boolean(hideSectionMetaChk.checked);
    renderSectionContentView();
    try {
      localStorage.setItem(HIDE_SECTION_META_PREVIEW_KEY, state.hideSectionMetaInPreview ? '1' : '0');
    } catch (_err) {
      // no-op
    }
  });
}

if (includeSectionMetaChk) {
  includeSectionMetaChk.addEventListener('change', () => {
    const nextValue = Boolean(includeSectionMetaChk.checked);
    const changed = nextValue !== state.includeSectionMetaInFiles;
    state.includeSectionMetaInFiles = nextValue;
    try {
      localStorage.setItem(INCLUDE_SECTION_META_FILES_KEY, state.includeSectionMetaInFiles ? '1' : '0');
    } catch (_err) {
      // no-op
    }
    if (changed && state.inputPdfPath) {
      markConversionDirty('Conversion options changed');
    } else {
      updateRunButtonState();
    }
  });
}

document.addEventListener('click', (event) => {
  if (supportMenuWrapEl && supportMenuEl && !supportMenuEl.hidden) {
    if (!supportMenuWrapEl.contains(event.target)) {
      closeSupportMenu();
    }
  }
  if (!sectionContextMenuEl || sectionContextMenuEl.hidden) return;
  if (sectionContextMenuEl.contains(event.target)) return;
  closeSectionContextMenu();
});

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

    try {
      const savedHideMeta = localStorage.getItem(HIDE_SECTION_META_PREVIEW_KEY);
      state.hideSectionMetaInPreview = savedHideMeta === '1';
    } catch (_err) {
      state.hideSectionMetaInPreview = false;
    }
    if (hideSectionMetaChk) {
      hideSectionMetaChk.checked = state.hideSectionMetaInPreview;
    }

    try {
      const savedIncludeMeta = localStorage.getItem(INCLUDE_SECTION_META_FILES_KEY);
      state.includeSectionMetaInFiles = savedIncludeMeta !== '0';
    } catch (_err) {
      state.includeSectionMetaInFiles = true;
    }
    if (includeSectionMetaChk) {
      includeSectionMetaChk.checked = state.includeSectionMetaInFiles;
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
      if (appMeta?.isPackaged) {
        buildStampEl.hidden = true;
      } else {
        buildStampEl.hidden = false;
        buildStampEl.textContent = `Build: v${appMeta?.version || '?'} | ${formatLocalDateTime(appMeta?.startedAt)}`;
      }
    }

    const defaults = await window.pdfToMdApi.getDefaultOutputRoot();
    state.outputRootPath = defaults.outputRoot || '';
    renderPathDisplays();
  } catch (_err) {
    if (buildStampEl) {
      buildStampEl.textContent = 'Build: unavailable';
      buildStampEl.hidden = false;
    }
    renderPathDisplays();
  }
  setStatus('Idle');
  updateRunButtonState();
  outlinePreviewEl.textContent = 'Select a PDF and click Run Conversion.';
  state.currentSectionRaw = 'Section content will appear here.';
  updateHideMetaControlState();
  renderSectionContentView();
})();

window.addEventListener('beforeunload', () => {
  stopConversionStatus();
  if (typeof unsubscribeConversionProgress === 'function') {
    unsubscribeConversionProgress();
    unsubscribeConversionProgress = null;
  }
});

if (supportMenuBtn && supportMenuEl) {
  supportMenuBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSupportMenu();
  });
}

if (reportBugBtn) {
  reportBugBtn.addEventListener('click', async () => {
    closeSupportMenu();
    try {
      await window.pdfToMdApi.openExternalUrl(ISSUES_URL);
    } catch (err) {
      alert(`Could not open Issues page: ${toUserErrorMessage(err, 'Could not open Issues page.')}`);
    }
  });
}

if (buyCoffeeBtn) {
  buyCoffeeBtn.addEventListener('click', async () => {
    closeSupportMenu();
    try {
      await window.pdfToMdApi.openExternalUrl(BUY_COFFEE_URL);
    } catch (err) {
      alert(`Could not open Buy Me a Coffee page: ${toUserErrorMessage(err, 'Could not open Buy Me a Coffee page.')}`);
    }
  });
}

if (aboutBtn && aboutDialog) {
  aboutBtn.addEventListener('click', () => {
    closeSupportMenu();
    aboutDialog.showModal();
  });
}

if (openRepoBtn) {
  openRepoBtn.addEventListener('click', async () => {
    try {
      await window.pdfToMdApi.openExternalUrl(REPO_URL);
    } catch (err) {
      alert(`Could not open repository URL: ${toUserErrorMessage(err, 'Could not open repository URL.')}`);
    }
  });
}

if (aboutBuyCoffeeBtn) {
  aboutBuyCoffeeBtn.addEventListener('click', async () => {
    try {
      await window.pdfToMdApi.openExternalUrl(BUY_COFFEE_URL);
    } catch (err) {
      alert(`Could not open Buy Me a Coffee page: ${toUserErrorMessage(err, 'Could not open Buy Me a Coffee page.')}`);
    }
  });
}

window.addEventListener('resize', () => {
  renderPathDisplays();
  renderSectionPathDisplay(state.currentSectionPath || '');
});
