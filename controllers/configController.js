const apiConfig = require('../services/apiConfig');

class ConfigController {
    static register(ipcMain) {
        ipcMain.handle('config:getEndpoints', async () => apiConfig.getEndpoints());
        ipcMain.handle('config:getBaseUrl', async () => apiConfig.getApiBaseUrl());
    }
}

module.exports = ConfigController;
