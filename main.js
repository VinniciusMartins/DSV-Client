const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const PrintController = require('./controllers/printController');

let mainWindow;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 980,
        height: 720,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // IMPORTANT: register IPC handlers BEFORE loading the renderer
    PrintController.register(ipcMain, mainWindow);

    await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    // mainWindow.webContents.openDevTools(); // optional
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
