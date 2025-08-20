const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AuthAPI', {
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    logout: () => ipcRenderer.invoke('auth:logout')
});

contextBridge.exposeInMainWorld('PrintAPI', {
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
    printPdf: (printerName, pdfPath) => ipcRenderer.invoke('print:printPdf', { printerName, pdfPath }),
    fetchLatestJob: (printerName) => ipcRenderer.invoke('print:fetchLatestJob', { printerName }),
    watchJob: (printerName, jobId) => ipcRenderer.invoke('print:watchJob', { printerName, jobId }),
    stopWatch: () => ipcRenderer.invoke('print:stopWatch'),

    onStatusTick: (handler) => {
        const wrapped = (_evt, payload) => handler(payload);
        ipcRenderer.on('print:statusTick', wrapped);
        return () => ipcRenderer.removeListener('print:statusTick', wrapped);
    }
});
