const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const PrintController = require('./controllers/printController');
const AuthController = require('./controllers/authController');
const ICON_PATH = path.join(__dirname, 'assets', 'printer.png');

let mainWindow;
let tray = null;
let isQuitting = false;

const isProd = app.isPackaged;

function createTray() {
    let icon = nativeImage.createFromPath(ICON_PATH);
    // Windows tray looks best at 16–24px; Electron will scale, but we can help:
    if (!icon.isEmpty() && process.platform === 'win32') {
        icon = icon.resize({ width: 16, height: 16 });
    }
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: (mainWindow?.isVisible() ? 'Hide' : 'Show'),
            click: () => { mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show(); } },
        { type: 'separator' },
        { label: 'Toggle DevTools', accelerator: 'Ctrl+Shift+I',
            click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]);

    tray.setToolTip('DSV-Client');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show(); });

}

async function createWindow() {
    // On Windows this helps associate the taskbar & notifications with your app
    app.setAppUserModelId('com.dsv.client');

    mainWindow = new BrowserWindow({
        width: 980,
        height: 720,
        icon: ICON_PATH,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !isProd, // only allow devtools in dev
        }
    });

    PrintController.register(ipcMain, mainWindow);
    AuthController.register(ipcMain);

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
app.on('window-all-closed', () => {
    // keep app running in tray on Windows; quit on non-win if desired
    if (process.platform !== 'darwin') {
        // do nothing; tray keeps it alive
    }
});
