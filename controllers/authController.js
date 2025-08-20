const AuthService = require('../services/authService');

class AuthController {
    static register(ipcMain) {
        const auth = new AuthService();

        ipcMain.handle('auth:login', async (_evt, { email, password }) => {
            return auth.login(email, password);
        });

        ipcMain.handle('auth:getUser', async () => {
            return auth.getUser();
        });

        ipcMain.handle('auth:logout', async () => {
            return auth.logout();
        });
    }
}

module.exports = AuthController;
