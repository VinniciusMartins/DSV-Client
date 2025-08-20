const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PrintAPI', {
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
    printPdf: (printerName, pdfPath) => ipcRenderer.invoke('print:printPdf', { printerName, pdfPath }),
    fetchLatestJob: (printerName) => ipcRenderer.invoke('print:fetchLatestJob', { printerName }),
    watchJob: (printerName, jobId) => ipcRenderer.invoke('print:watchJob', { printerName, jobId }),
    stopWatch: () => ipcRenderer.invoke('print:stopWatch'),

    // live status ticker
    onStatusTick: (handler) => {
        const wrapped = (_evt, payload) => handler(payload);
        ipcRenderer.on('print:statusTick', wrapped);
        return () => ipcRenderer.removeListener('print:statusTick', wrapped);
    }
});
