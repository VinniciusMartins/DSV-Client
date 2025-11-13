// controllers/zebraController.js
const fs = require('fs');
const path = require('path');
const net = require('net');
const PowerShellService = require('../services/powershellService');

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

const psRawPrinter = new PowerShellService();

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

async function sendRawToPrinter(printerName, zpl) {
    const name = String(printerName || '').trim();
    if (!name) throw new Error('printer name missing');
    const payload = Buffer.from(zpl || '', 'utf8');
    if (!payload.length) throw new Error('zpl empty');

    const base64 = payload.toString('base64');
    const nameEsc = name.replace(/`/g, '``').replace(/"/g, '""');
    const script = `
$ErrorActionPreference = 'Stop'
$printer = "${nameEsc}"
$bytes = [Convert]::FromBase64String('${base64}')
if (-not ('Win32.RawPrinterHelper' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Win32 {
    public static class RawPrinterHelper {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOCINFO {
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDataType;
        }

        [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFO di);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool WritePrinter(IntPtr hPrinter, byte[] data, int count, out int written);

        public static void SendBytes(string printerName, byte[] bytes, string docName = null) {
            if (string.IsNullOrWhiteSpace(printerName)) {
                throw new ArgumentNullException(nameof(printerName));
            }
            if (bytes == null || bytes.Length == 0) {
                throw new ArgumentNullException(nameof(bytes));
            }

            IntPtr hPrinter;
            if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) {
                throw new System.ComponentModel.Win32Exception();
            }

            try {
                var di = new DOCINFO {
                    pDocName = string.IsNullOrWhiteSpace(docName) ? "ZPL Label" : docName,
                    pDataType = "RAW"
                };

                if (!StartDocPrinter(hPrinter, 1, di)) {
                    throw new System.ComponentModel.Win32Exception();
                }

                if (!StartPagePrinter(hPrinter)) {
                    throw new System.ComponentModel.Win32Exception();
                }

                int written;
                if (!WritePrinter(hPrinter, bytes, bytes.Length, out written) || written != bytes.Length) {
                    throw new System.ComponentModel.Win32Exception();
                }

                if (!EndPagePrinter(hPrinter)) {
                    throw new System.ComponentModel.Win32Exception();
                }

                if (!EndDocPrinter(hPrinter)) {
                    throw new System.ComponentModel.Win32Exception();
                }
            }
            finally {
                ClosePrinter(hPrinter);
            }
        }
    }
}
"@
}

[Win32.RawPrinterHelper]::SendBytes($printer, $bytes, 'ZPL Label from DSV-Client')
'OK'
`.trim();

    const result = await psRawPrinter.run(script);
    if (!/OK/i.test(result || '')) {
        throw new Error(result || 'Raw print failed');
    }
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

        ipcMain.handle('zebra:printUsb', async (e, { printerName, zpl }) => {
            try {
                await sendRawToPrinter(printerName, zpl);
                return { success: true };
            } catch (err) {
                return { success: false, message: err.message || 'error' };
            }
        });
    }
};
