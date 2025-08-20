const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const PrintController = require('./controllers/printController');
const AuthController  = require('./controllers/authController');
const QueueController = require('./controllers/queueController'); // ← IMPORTANT

let mainWindow;
let tray = null;
let isQuitting = false;

const ICON_PATH = path.join(__dirname, 'assets', 'printer.png');

function createTray() {
    let icon = nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty() && process.platform === 'win32') icon = icon.resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
        { label: 'Show', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { label: 'Hide', click: () => { mainWindow?.hide(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('DSV-Client');
    tray.setContextMenu(menu);
    tray.on('click', () => { mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show(); });
}

async function createWindow() {
    app.setAppUserModelId('com.dsv.client');

    mainWindow = new BrowserWindow({
        width: 980,
        height: 720,
        icon: ICON_PATH,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // IMPORTANT: register ALL IPC handlers BEFORE loading any renderer HTML
    PrintController.register(ipcMain, mainWindow);
    AuthController.register(ipcMain);
    QueueController.register(ipcMain, mainWindow); // ← THIS LINE fixes the “No handler registered” error

    await mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));

    mainWindow.on('close', (e) => {
        if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
    });
}

app.whenReady().then(() => {
    createTray();
    createWindow();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { /* keep alive for tray on Windows */ });
