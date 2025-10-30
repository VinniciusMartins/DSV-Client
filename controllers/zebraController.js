// controllers/zebraController.js
const fs = require('fs');
const path = require('path');
const net = require('net');

function zebraStorePath(app) {
    const dir = app.getPath('userData');
    const file = path.join(dir, 'zebra_printers.json');
    return { dir, file };
}

function readZebras(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return []; }
}

function writeZebras(dir, file, list) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

function sendRaw9100(host, port, data) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(8000);
        socket.connect(port, host, () => socket.write(data, 'utf8', () => socket.end()));
        socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        socket.on('error', reject);
        socket.on('close', resolve);
    });
}

module.exports = {
    register(ipcMain, app) {
        const { dir, file } = zebraStorePath(app);

        ipcMain.handle('zebra:list', () => {
            return readZebras(file);
        });

        ipcMain.handle('zebra:add', (e, { name, host, port }) => {
            if (!name || !host) return { success: false, message: 'name and host required' };
            const list = readZebras(file);
            const id = `${name}@${host}:${port || 9100}`;
            if (!list.find(z => z.id === id)) list.push({ id, name, host, port: port || 9100 });
            writeZebras(dir, file, list);
            return { success: true, id };
        });

        ipcMain.handle('zebra:remove', (e, id) => {
            const list = readZebras(file).filter(z => z.id !== id);
            writeZebras(dir, file, list);
            return { success: true };
        });

        ipcMain.handle('zebra:test', async (e, id) => {
            const z = readZebras(file).find(x => x.id === id);
            if (!z) return { success: false, message: 'not found' };
            try {
                await sendRaw9100(z.host, z.port, '^XA^FO30,30^ADN,36,20^FDTEST^FS^XZ');
                return { success: true };
            } catch (err) {
                return { success: false, message: err.message || 'error' };
            }
        });

        ipcMain.handle('zebra:print', async (e, { id, zpl }) => {
            const z = readZebras(file).find(x => x.id === id);
            if (!z) return { success: false, message: 'not found' };
            if (!zpl) return { success: false, message: 'zpl empty' };
            try {
                await sendRaw9100(z.host, z.port, zpl);
                return { success: true };
            } catch (err) {
                return { success: false, message: err.message || 'error' };
            }
        });

        ipcMain.handle('zebra:printDirect', async (e, { host, port, zpl }) => {
            if (!host || !zpl) return { success: false, message: 'host or zpl missing' };
            const p = parseInt(port, 10) || 9100;
            try {
                await sendRaw9100(host, p, zpl);
                return { success: true };
            } catch (err) {
                return { success: false, message: err.message || 'error' };
            }
        });
    }
};
