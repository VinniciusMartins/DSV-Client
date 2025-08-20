// services/printService.js
const { BrowserWindow } = require('electron');
const PowerShellService = require('./powershellService');

const STATES = {
    PRINTING: 'Printing',
    PAUSED: 'Paused',
    RETAINED: 'Retained',
    DELETING: 'Deleting',
    WAITING: 'Waiting', // PS "Normal" (queued)
    UNKNOWN: 'Unknown'
};

// When a job disappears from the spooler and the last known state was one of these,
// we will treat the outcome as "deleted" (not "printed").
const DELETED_ON_DISAPPEAR = new Set([STATES.DELETING, STATES.PAUSED, STATES.WAITING]);

class PrintService {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.ps = new PowerShellService();

        this._watchInterval = null;
        this._lastStatus = null;
        this._watchingJob = { printerName: null, jobId: null };
        this.pollMs = 1000; // status poll interval (ms)
    }

    /** Print a remote PDF URL without writing to disk; fallback to data: URL if direct load fails. */
    async printFromUrl(printerName, pdfUrl) {
        let win;
        try {
            win = new BrowserWindow({
                show: false,
                webPreferences: { backgroundThrottling: false }
            });

            // Try loading the presigned S3 URL directly
            await win.loadURL(pdfUrl);
            await new Promise(r => setTimeout(r, 800)); // let the viewer initialize

            await new Promise((resolve, reject) => {
                win.webContents.print(
                    { silent: true, deviceName: printerName, printBackground: true },
                    (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'Print failed')))
                );
            });

            return { success: true, message: 'Print sent to spooler (URL)' };
        } catch (err) {
            // Fallback: fetch to memory and render as data: URL (still no temp file)
            try {
                const res = await fetch(pdfUrl);
                if (!res.ok) throw new Error(`Fetch ${res.status}`);
                const buf = Buffer.from(await res.arrayBuffer());
                const dataUrl = `data:application/pdf;base64,${buf.toString('base64')}`;

                if (!win || win.isDestroyed()) {
                    win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
                }
                await win.loadURL(dataUrl);
                await new Promise(r => setTimeout(r, 700));
                await new Promise((resolve, reject) => {
                    win.webContents.print(
                        { silent: true, deviceName: printerName, printBackground: true },
                        (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'Print failed')))
                    );
                });

                return { success: true, message: 'Print sent to spooler (data URL)' };
            } catch (fallbackErr) {
                return {
                    success: false,
                    message: `URL print failed: ${err?.message} | dataURL: ${fallbackErr?.message}`
                };
            }
        } finally {
            if (win && !win.isDestroyed()) {
                try { await new Promise(r => setTimeout(r, 150)); } catch {}
                win.destroy();
            }
        }
    }

    // ---------- Job fetch ----------
    async fetchLatestJob(printerName) {
        try {
            const job = await this.ps.getLatestPrintJob(printerName);
            if (!job) return { success: true, job: null };
            return { success: true, job: Array.isArray(job) ? job[0] : job };
        } catch (e) {
            return { success: false, message: String(e.message || e) };
        }
    }

    // ---------- Status tick to renderer ----------
    _sendTick(payload) {
        try { this.mainWindow?.webContents.send('print:statusTick', payload); } catch {}
    }

    // Normalize PS status -> one of our STATES (handles "Printing, Retained", etc.)
    _normalizeStatus(job) {
        const rawText = String(job?.JobStatusText || job?.JobStatus || '').trim().toLowerCase();
        if (!rawText) return STATES.UNKNOWN;
        if (rawText.includes('deleting')) return STATES.DELETING;
        if (rawText.includes('paused'))   return STATES.PAUSED;
        if (rawText.includes('printing') || rawText.includes('spooling') || rawText.includes('processing')) return STATES.PRINTING;
        if (rawText.includes('retained')) return STATES.RETAINED;
        if (rawText.includes('normal'))   return STATES.WAITING; // queued
        return STATES.UNKNOWN;
    }

    /**
     * Watch a job until it finishes or is deleted.
     * options:
     *  - stopOnPause (bool): if true, resolve immediately with { state:'paused' } when job becomes Paused
     *                         (queue code now generally passes false to keep tracking through pause)
     *
     * Resolves with:
     *  - { success:true, state:'printed' }    when job disappears and last status not in DELETED_ON_DISAPPEAR
     *  - { success:true, state:'deleted' }    when job disappears and last status was Deleting/Paused/Waiting
     *  - { success:true, state:'paused' }     if stopOnPause==true and job hits Paused
     */
    async watchJob(printerName, jobId, options = {}) {
        const stopOnPause = !!options.stopOnPause;

        this.stopWatch();
        this._watchingJob = { printerName, jobId: Number(jobId) };
        this._lastStatus = null;

        // fire an immediate first tick if job is present
        try {
            const first = await this.ps.getJobById(printerName, Number(jobId));
            if (first) {
                const status = this._normalizeStatus(first);
                this._lastStatus = status;
                this._sendTick({ jobId: Number(jobId), status, raw: first });
                if (stopOnPause && status === STATES.PAUSED) {
                    return { success: true, state: 'paused', message: 'Paused by printer' };
                }
            }
        } catch { /* ignore */ }

        // polling loop
        return await new Promise((resolve) => {
            this._watchInterval = setInterval(async () => {
                let job = null;
                try {
                    job = await this.ps.getJobById(this._watchingJob.printerName, this._watchingJob.jobId);
                } catch { job = null; }

                if (!job) {
                    // Disappeared from spooler → decide printed vs deleted based on last known state
                    const last = this._lastStatus || STATES.UNKNOWN;
                    const treatAsDeleted = DELETED_ON_DISAPPEAR.has(last);
                    this.stopWatch();
                    return resolve({
                        success: true,
                        state: treatAsDeleted ? 'deleted' : 'printed',
                        message: treatAsDeleted ? 'Deleted successfully' : 'Printed successfully'
                    });
                }

                const status = this._normalizeStatus(job);
                this._lastStatus = status || this._lastStatus || STATES.UNKNOWN;
                this._sendTick({ jobId: this._watchingJob.jobId, status: this._lastStatus, raw: job });

                if (stopOnPause && status === STATES.PAUSED) {
                    this.stopWatch();
                    return resolve({ success: true, state: 'paused', message: 'Paused by printer' });
                }
            }, this.pollMs);
        });
    }

    stopWatch() {
        if (this._watchInterval) clearInterval(this._watchInterval);
        this._watchInterval = null;
    }
}

module.exports = PrintService;
