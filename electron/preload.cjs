const { contextBridge, ipcRenderer, webUtils } = require('electron');
const CONVERSION_PROGRESS_EVENT = 'conversion-progress';

contextBridge.exposeInMainWorld('pdfToMdApi', {
  getPathForFile: (file) => {
    try {
      if (!file || typeof webUtils?.getPathForFile !== 'function') return '';
      return String(webUtils.getPathForFile(file) || '');
    } catch (_err) {
      return '';
    }
  },
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickOutputDir: (currentPath) => ipcRenderer.invoke('pick-output-dir', currentPath),
  getDefaultOutputRoot: () => ipcRenderer.invoke('get-default-output-root'),
  getAppMeta: () => ipcRenderer.invoke('get-app-meta'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  validateInputPdf: (candidatePath) => ipcRenderer.invoke('validate-input-pdf', candidatePath),
  resolveDroppedInputPdf: (payload) => ipcRenderer.invoke('resolve-dropped-input-pdf', payload),
  onConversionProgress: (handler) => {
    const listener = (_event, payload) => {
      if (typeof handler === 'function') {
        handler(payload);
      }
    };
    ipcRenderer.on(CONVERSION_PROGRESS_EVENT, listener);
    return () => ipcRenderer.removeListener(CONVERSION_PROGRESS_EVENT, listener);
  },
  runConversion: (inputPdfPath, outputRootPath, options) =>
    ipcRenderer.invoke('run-conversion', inputPdfPath, outputRootPath, options),
  loadOutline: (inputPdfPath, outputRootPath) => ipcRenderer.invoke('load-outline', inputPdfPath, outputRootPath),
  loadSection: (inputPdfPath, outputRootPath, sectionRelativePath) =>
    ipcRenderer.invoke('load-section', inputPdfPath, outputRootPath, sectionRelativePath),
  openSectionInFolder: (inputPdfPath, outputRootPath, sectionRelativePath) =>
    ipcRenderer.invoke('open-section-in-folder', inputPdfPath, outputRootPath, sectionRelativePath),
  openSectionDefault: (inputPdfPath, outputRootPath, sectionRelativePath) =>
    ipcRenderer.invoke('open-section-default', inputPdfPath, outputRootPath, sectionRelativePath),
  copySectionPath: (inputPdfPath, outputRootPath, sectionRelativePath) =>
    ipcRenderer.invoke('copy-section-path', inputPdfPath, outputRootPath, sectionRelativePath),
  openOutputDir: (inputPdfPath, outputRootPath) => ipcRenderer.invoke('open-output-dir', inputPdfPath, outputRootPath),
});
