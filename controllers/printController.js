// controllers/printController.js
const { BrowserWindow } = require('electron');
const PrintService = require('../services/printService');

class PrintController {
    static register(ipcMain, mainWindow) {
        const service = new PrintService(mainWindow);

        ipcMain.handle('print:getPrinters', async () => {
            try {
                const win = mainWindow || BrowserWindow.getAllWindows()[0] || null;
                if (!win) return [];
                return await win.webContents.getPrintersAsync();
            } catch (e) {
                console.error('getPrinters failed', e);
                return [];
            }
        });

        ipcMain.handle('print:fetchLatestJob', async (_evt, { printerName }) => {
            return service.fetchLatestJob(printerName);
        });

        ipcMain.handle('print:watchJob', async (_evt, { printerName, jobId, options }) => {
            return service.watchJob(printerName, jobId, options || {});
        });

        ipcMain.handle('print:stopWatch', async () => {
            service.stopWatch();
            return { ok: true };
        });
    }
}

module.exports = PrintController;
