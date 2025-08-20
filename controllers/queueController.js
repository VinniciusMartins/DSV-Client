// controllers/queueController.js
const QueueService = require('../services/queueService');

class QueueController {
    static register(ipcMain, mainWindow) {
        const queue = new QueueService(mainWindow);

        ipcMain.handle('queue:start', async (_evt, { printerName, token }) => {
            return queue.start(printerName, token);
        });

        ipcMain.handle('queue:stop', async () => {
            return queue.stop('manual-stop');
        });

        // If you implemented "Reprint Previous" in your UI:
        ipcMain.handle('queue:reprintLast', async (_evt, { printerName }) => {
            return queue.reprintLast(printerName);
        });

        // Optional: simple sanity log so you can see it's registered
        console.log('[QueueController] IPC handlers registered: queue:start, queue:stop, queue:reprintLast');
    }
}

module.exports = QueueController;
