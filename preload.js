// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('AuthAPI', {
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    logout: () => ipcRenderer.invoke('auth:logout')
});

contextBridge.exposeInMainWorld('PrintAPI', {
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
    fetchLatestJob: (printerName) => ipcRenderer.invoke('print:fetchLatestJob', { printerName }),
    watchJob: (printerName, jobId, options) => ipcRenderer.invoke('print:watchJob', { printerName, jobId, options }),
    stopWatch: () => ipcRenderer.invoke('print:stopWatch'),
    onStatusTick: (handler) => {
        const wrapped = (_evt, payload) => handler(payload);
        ipcRenderer.on('print:statusTick', wrapped);
        return () => ipcRenderer.removeListener('print:statusTick', wrapped);
    }
});

// Queue controls (auto print & reprint last)
contextBridge.exposeInMainWorld('QueueAPI', {
    start: (printerName, token) => ipcRenderer.invoke('queue:start', { printerName, token }),
    stop: () => ipcRenderer.invoke('queue:stop'),
    reprintLast: (printerName) => ipcRenderer.invoke('queue:reprintLast', { printerName }),

    onState: (handler) => {
        const wrapped = (_evt, payload) => handler(payload);
        ipcRenderer.on('queue:state', wrapped);
        return () => ipcRenderer.removeListener('queue:state', wrapped);
    },
    onLog: (handler) => {
        const wrapped = (_evt, payload) => handler(payload);
        ipcRenderer.on('queue:log', wrapped);
        return () => ipcRenderer.removeListener('queue:log', wrapped);
    }
});

contextBridge.exposeInMainWorld('ZebraAPI', {
    list:   () => ipcRenderer.invoke('zebra:list'),
    add:    (printer) => ipcRenderer.invoke('zebra:add', printer),
    remove: (id) => ipcRenderer.invoke('zebra:remove', id),
    test:   (id) => ipcRenderer.invoke('zebra:test', id),
    print:  (id, zpl) => ipcRenderer.invoke('zebra:print', { id, zpl }),
    printDirect: (host, port, zpl) => ipcRenderer.invoke('zebra:printDirect', { host, port, zpl })
});

contextBridge.exposeInMainWorld('ConfigAPI', {
    getEndpoints: () => ipcRenderer.invoke('config:getEndpoints'),
    getApiBaseUrl: () => ipcRenderer.invoke('config:getBaseUrl')
});
