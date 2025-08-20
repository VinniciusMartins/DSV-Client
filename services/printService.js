const path = require('path');
const { BrowserWindow } = require('electron');
const PowerShellService = require('./powershellService');

const STATES = {
    PRINTING: 'Printing',
    PAUSED: 'Paused',
    RETAINED: 'Retained',
    DELETING: 'Deleting',
    WAITING: 'Waiting' // PS "Normal"
};

class PrintService {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.ps = new PowerShellService();
        this._watchInterval = null;
        this._lastStatus = null;
        this._watchingJob = { printerName: null, jobId: null };
        this.pollMs = 1500;
    }

    async printPdf(printerName, pdfPath) {
        try {
            const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
            const p = process.platform === 'win32' ? 'file:///' + path.resolve(pdfPath).replace(/\\/g, '/') : 'file://' + path.resolve(pdfPath);
            await win.loadURL(p);
            await new Promise((resolve, reject) => {
                win.webContents.print({ silent: true, deviceName: printerName, printBackground: true }, (ok, reason) => ok ? resolve() : reject(new Error(reason || 'Print failed')));
            });
            return { success: true, message: 'Print sent to spooler' };
        } catch (err) {
            console.error('printPdf error:', err);
            return { success: false, message: String(err.message || err) };
        }
    }

    async fetchLatestJob(printerName) {
        try {
            const job = await this.ps.getLatestPrintJob(printerName);
            if (!job) return { success: true, job: null };
            return { success: true, job: Array.isArray(job) ? job[0] : job };
        } catch (e) {
            return { success: false, message: String(e.message || e) };
        }
    }

    _sendTick(payload) {
        try { this.mainWindow?.webContents.send('print:statusTick', payload); } catch {}
    }

    // normalize PS status -> one of our STATES
    _normalizeStatus(job) {
        const raw = String(job?.JobStatusText || job?.JobStatus || '').trim().toLowerCase();
        if (!raw) return 'Unknown';
        if (raw.includes('deleting')) return STATES.DELETING;
        if (raw.includes('paused'))   return STATES.PAUSED;
        if (raw.includes('printing') || raw.includes('spooling') || raw.includes('processing')) return STATES.PRINTING;
        if (raw.includes('retained')) return STATES.RETAINED;
        if (raw.includes('normal'))   return STATES.WAITING; // queued/normal
        return 'Unknown';
    }

    async watchJob(printerName, jobId) {
        this.stopWatch();
        this._watchingJob = { printerName, jobId: Number(jobId) };
        this._lastStatus = null;

        const decide = (job) => {
            if (!job) {
                // If it vanished while last seen as Deleting OR Paused => treat as deleted
                if (this._lastStatus === STATES.DELETING || this._lastStatus === STATES.PAUSED) {
                    return { done: true, result: { state: 'deleted', message: 'Deleted successfully' } };
                }
                // Otherwise assume it completed printing
                return { done: true, result: { state: 'printed', message: 'Printed successfully' } };
            }

            const status = this._normalizeStatus(job);
            this._lastStatus = status || this._lastStatus || 'Unknown';
            this._sendTick({ jobId: this._watchingJob.jobId, status: this._lastStatus, raw: job });
            return { done: false };
        };

        return await new Promise((resolve) => {
            this._watchInterval = setInterval(async () => {
                let job = null;
                try { job = await this.ps.getJobById(this._watchingJob.printerName, this._watchingJob.jobId); } catch {}
                const { done, result } = decide(job);
                if (done) { this.stopWatch(); resolve({ success: true, ...result }); }
            }, this.pollMs);
        });
    }

    stopWatch() {
        if (this._watchInterval) clearInterval(this._watchInterval);
        this._watchInterval = null;
    }
}

module.exports = PrintService;
