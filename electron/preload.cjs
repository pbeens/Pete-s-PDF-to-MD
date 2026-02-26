const { contextBridge, ipcRenderer } = require('electron');
const CONVERSION_PROGRESS_EVENT = 'conversion-progress';

contextBridge.exposeInMainWorld('pdfToMdApi', {
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickOutputDir: (currentPath) => ipcRenderer.invoke('pick-output-dir', currentPath),
  getDefaultOutputRoot: () => ipcRenderer.invoke('get-default-output-root'),
  getAppMeta: () => ipcRenderer.invoke('get-app-meta'),
  onConversionProgress: (handler) => {
    const listener = (_event, payload) => {
      if (typeof handler === 'function') {
        handler(payload);
      }
    };
    ipcRenderer.on(CONVERSION_PROGRESS_EVENT, listener);
    return () => ipcRenderer.removeListener(CONVERSION_PROGRESS_EVENT, listener);
  },
  runConversion: (inputPdfPath, outputRootPath) => ipcRenderer.invoke('run-conversion', inputPdfPath, outputRootPath),
  loadOutline: (inputPdfPath, outputRootPath) => ipcRenderer.invoke('load-outline', inputPdfPath, outputRootPath),
  loadSection: (inputPdfPath, outputRootPath, sectionRelativePath) =>
    ipcRenderer.invoke('load-section', inputPdfPath, outputRootPath, sectionRelativePath),
  openOutputDir: (inputPdfPath, outputRootPath) => ipcRenderer.invoke('open-output-dir', inputPdfPath, outputRootPath),
});
