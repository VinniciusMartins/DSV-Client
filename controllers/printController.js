const { BrowserWindow } = require('electron');
const PrintService = require('../services/printService');

class PrintController {
    static register(ipcMain, mainWindow) {
        const service = new PrintService(mainWindow);

        // Get printers (with safe fallback to any existing window)
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

        // Send PDF to printer
        ipcMain.handle('print:printPdf', async (_evt, { printerName, pdfPath }) => {
            return service.printPdf(printerName, pdfPath);
        });

        // Fetch latest (most recent) job from a printer
        ipcMain.handle('print:fetchLatestJob', async (_evt, { printerName }) => {
            return service.fetchLatestJob(printerName);
        });

        // Start watching a specific job id
        ipcMain.handle('print:watchJob', async (_evt, { printerName, jobId }) => {
            return service.watchJob(printerName, jobId);
        });

        // Stop watching (if any)
        ipcMain.handle('print:stopWatch', async () => {
            service.stopWatch();
            return { ok: true };
        });
    }
}

module.exports = PrintController;
