// services/queueService.js
const PrintService = require('./printService');

class QueueService {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.print = new PrintService(mainWindow);

        this.isListening = false;
        this._loopPromise = null;
        this._stopReason = null;
        this._token = null;
        this._printerName = null;

        this.idlePollMs = 2000; // poll when no job available

        // Track last successfully printed PDF (for "Reprint previous PDF")
        this._lastUrl = null;
        this._lastFilename = null;
        this._lastJobId = null; // API job id
    }

    // ---------- IPC helpers ----------
    _emitState(state, extra = {}) {
        try { this.mainWindow?.webContents.send('queue:state', { state, ...extra }); } catch {}
    }
    _emitLog(msg) {
        try { this.mainWindow?.webContents.send('queue:log', { msg, ts: Date.now() }); } catch {}
    }
    _emitTick(jobId, status) {
        try { this.mainWindow?.webContents.send('print:statusTick', { jobId, status }); } catch {}
    }
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---------- utils ----------
    _maskUrl(u) {
        try {
            const url = new URL(u);
            const file = url.pathname.split('/').pop() || '';
            const short = `${url.hostname}/${file}`;
            return short.length > 72 ? short.slice(0, 72) + '…' : short;
        } catch {
            return (u || '').slice(0, 72) + '…';
        }
    }
    // Normalize raw PS text like "Printing, Retained" -> "Printing"
    _normalizeRaw(raw) {
        const s = String(raw || '').toLowerCase();
        if (s.includes('deleting')) return 'Deleting';
        if (s.includes('paused'))   return 'Paused';
        if (s.includes('printing') || s.includes('spooling') || s.includes('processing')) return 'Printing';
        if (s.includes('retained')) return 'Retained';
        if (s.includes('normal'))   return 'Waiting';
        return 'Unknown';
    }

    async _ensureStopped(reason = 'restart') {
        // Emit "stopping" immediately so the UI flips right away
        this._stopReason = reason;
        this._emitState('stopping', { reason });

        // Stop queue loop
        if (this.isListening) {
            this.isListening = false;
            try { await this._loopPromise; } catch {}
        }
        // Stop any active watcher
        this.print.stopWatch();

        // And confirm final stopped state
        this._emitState('stopped', { reason });
    }

    /**
     * Watcher with a "forwarder" that pushes live ticks every poll,
     * and emits queue state hints:
     *  - 'paused-tracking' when status is Paused
     *  - 'tracking' otherwise (Printing/Waiting/Retained)
     *
     * IMPORTANT: We do NOT stop on pause here (stopOnPause: false).
     * The watcher only resolves when the job DISAPPEARS:
     *  - if last status was Paused/Deleting => 'deleted'
     *  - else => 'printed'
     */
    async _watchWithForwarder(jobId) {
        const pollMs = this.print?.pollMs || 1000;
        let cancelled = false;
        let lastState = null;

        const forward = setInterval(async () => {
            if (cancelled) return;
            try {
                const job = await this.print.ps.getJobById(this._printerName, Number(jobId));
                if (job) {
                    const raw = job.JobStatusText || job.JobStatus || 'Unknown';
                    const now = this._normalizeRaw(raw);
                    if (now !== lastState) {
                        this._emitTick(jobId, now);
                        // reflect queue state while we're tracking this single job
                        if (now === 'Paused') this._emitState('paused-tracking', { jobId });
                        else this._emitState('tracking', { jobId });
                        lastState = now;
                    }
                }
            } catch { /* ignore transient PS errors */ }
        }, pollMs);

        try {
            // DO NOT stop on pause: keep watching until job disappears
            const outcome = await this.print.watchJob(this._printerName, Number(jobId), { stopOnPause: false });
            return outcome;
        } finally {
            cancelled = true;
            clearInterval(forward);
        }
    }

    // ---------- public controls ----------
    async start(printerName, token) {
        await this._ensureStopped('retry-start');

        this._token = token || null;
        this._printerName = printerName;
        this.isListening = true;
        this._stopReason = null;

        this._emitState('listening', { printerName });

        this._loopPromise = this._loop().finally(() => {
            this.isListening = false;
            // Final stopped confirmation (covers unexpected exits)
            this._emitState('stopped', { reason: this._stopReason || 'done' });
        });

        return { success: true, state: 'listening' };
    }

    async stop(reason = 'stop') {
        await this._ensureStopped(reason);
        return { success: true, state: 'stopped' };
    }

    async reprintLast(printerName) {
        await this._ensureStopped('reprint-last');

        if (!this._lastUrl) return { success: false, message: 'No previous PDF available to reprint.' };
        const url = this._lastUrl;
        const pName = printerName || this._printerName;
        if (!pName) return { success: false, message: 'No printer selected.' };

        this._emitLog(`[Queue] Reprinting previous PDF: ${this._lastFilename || this._maskUrl(url)} (apiId: ${this._lastJobId ?? 'n/a'})`);

        // Race the print call so we don’t block discovery if the callback hangs
        let sent;
        try {
            sent = await Promise.race([
                this.print.printFromUrl(pName, url).catch(e => ({ success: false, message: e?.message || 'print error' })),
                this._sleep(2500).then(() => ({ success: true, message: 'spool assumed (race timeout)' }))
            ]);
        } catch (err) {
            this._emitLog(`[Queue] Reprint exception: ${err?.message || err}`);
            return { success: false, message: err?.message || 'Reprint failed' };
        }

        this._emitLog(`[Queue] Reprint spool step done: ${sent.success ? 'ok' : 'err'} (${sent.message || ''})`);

        // Small wait and then discover with retries
        await this._sleep(600);
        const found = await this._discoverLatestJobWithRetries(pName, 6, 700);
        if (!found.success) return { success: false, message: found.message || 'Reprint job lookup failed' };

        if (!found.job) {
            // no spooler entry — still success
            this._emitLog('[Queue] Reprint finished instantly (no queue entry).');
            this._emitTick('reprint', 'printed');
            return { success: true, state: 'printed' };
        }

        const id  = found.id;
        const now = found.now;
        this._emitLog(`[Queue] Reprint watching job #${id} (${now}).`);
        this._emitTick(id, now);

        const outcome = await this._watchWithForwarder(id);
        if (!outcome.success) return { success: false, message: outcome.message || 'Watch failed' };

        if (outcome.state === 'printed') {
            this._emitTick(id, 'printed');
            this._emitLog('[Queue] Reprint completed successfully.');
            return { success: true, state: 'printed' };
        }
        if (outcome.state === 'deleted') {
            this._emitTick(id, 'deleted');
            this._emitLog('[Queue] Reprint ended: deleted.');
            return { success: true, state: 'deleted' };
        }
        return { success: true, state: outcome.state || 'done' };
    }

    // ---------- main loop ----------
    async _loop() {
        while (this.isListening) {
            // 1) Ask Laravel for next job (S3 presigned URL)
            const job = await this._fetchNextFromApi(this._token).catch(err => {
                this._emitLog(`[Queue] API error: ${err?.message || err}`);
                return null;
            });

            if (!this.isListening) break;

            if (!job || !job.url) {
                await this._sleep(this.idlePollMs);
                continue;
            }

            // 2) Print directly from URL — race with timer so we always proceed
            this._emitLog(`[Queue] Printing ${job.filename || this._maskUrl(job.url)} (apiId: ${job.id ?? 'n/a'})`);
            let sent;
            try {
                sent = await Promise.race([
                    this.print.printFromUrl(this._printerName, job.url).catch(e => ({ success: false, message: e?.message || 'print error' })),
                    this._sleep(2500).then(() => ({ success: true, message: 'spool assumed (race timeout)' }))
                ]);
            } catch (err) {
                this._emitLog(`[Queue] Print exception: ${err?.message || err}`);
                await this._ensureStopped('print-exception');
                break;
            }

            this._emitLog(`[Queue] Spool step done: ${sent.success ? 'ok' : 'err'} (${sent.message || ''})`);

            if (!sent.success) {
                const expired = /403|AccessDenied|Expired|Signature/i.test(sent.message || '');
                this._emitLog(`[Queue] Print error: ${sent.message}${expired ? ' (likely expired presigned URL)' : ''}`);
                await this._ensureStopped(expired ? 'url-expired' : 'print-error');
                break;
            }

            // 3) Discover job in spool with retries (spooler can lag)
            await this._sleep(600);
            const found = await this._discoverLatestJobWithRetries(this._printerName, 6, 700);
            if (!found.success) {
                this._emitLog(`[Queue] Could not fetch latest job: ${found.message}`);
                await this._ensureStopped('job-lookup-failed');
                break;
            }

            if (!found.job) {
                // Finished too fast — still a success. Emit synthetic success tick.
                this._lastUrl = job.url;
                this._lastFilename = job.filename || null;
                this._lastJobId = job.id ?? null;
                this._emitLog('[Queue] Job finished instantly (no queue entry).');
                this._emitTick('instant', 'printed');
                // ✅ Update Laravel: printed successfully (instant finish)
                if (job.id) {
                    await this._updatePdfStatusPrinted(job.id, this._token);
                }
                continue;
            }

            const id  = found.id;
            const now = found.now;

            this._emitLog(`[Queue] Watching job #${id} (now=${now}).`);
            this._emitTick(id, now);

            // IMPORTANT: keep watching even if it goes to Paused; only resolve on disappearance
            const outcome = await this._watchWithForwarder(id);
            if (!outcome.success) {
                this._emitLog(`[Queue] Watch error: ${outcome.message || 'unknown'}`);
                await this._ensureStopped('watch-error');
                break;
            }

            if (outcome.state === 'printed') {
                // success — remember for "reprint previous"
                this._emitTick(id, 'printed');
                this._lastUrl = job.url;
                this._lastFilename = job.filename || null;
                this._lastJobId = job.id ?? null;

                // ✅ Update Laravel: printed successfully
                if (job.id) {
                    await this._updatePdfStatusPrinted(job.id, this._token);
                }

                this._emitLog('[Queue] Printed successfully — requesting next.');
                // loop continues and fetches next job
            } else if (outcome.state === 'deleted') {
                this._emitTick(id, 'deleted');
                this._emitLog('[Queue] Job deleted — stopping queue.');
                await this._ensureStopped('deleted');
                break;
            } else {
                // Shouldn't see 'paused' now; watcher only resolves on disappearance
                this._emitLog(`[Queue] Stopping due to outcome: ${outcome.state}`);
                await this._ensureStopped(outcome.state || 'stopped');
                break;
            }
        }
    }

    // Discover latest job with a few retries, returning normalized status
    async _discoverLatestJobWithRetries(printerName, attempts = 6, delayMs = 700) {
        for (let i = 1; i <= attempts; i++) {
            const latest = await this.print.fetchLatestJob(printerName);
            if (!latest.success) {
                if (i >= attempts) return { success: false, message: latest.message || 'latest lookup failed' };
            } else if (latest.job) {
                const id  = latest.job.Id || latest.job.ID || latest.job.id;
                const raw = latest.job.JobStatusText || latest.job.JobStatus || latest.job.jobStatus || 'Unknown';
                const now = this._normalizeRaw(raw);
                this._emitLog(`[Queue] Latest job found (try ${i}/${attempts}): #${id}, raw="${raw}", now="${now}"`);
                return { success: true, job: latest.job, id, now };
            }
            await this._sleep(delayMs);
        }
        return { success: true, job: null };
    }

    // ---------- API client ----------
    async _fetchNextFromApi(token) {
        const url = 'http://18.228.150.85/api/printQueue';

        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 15000); // 15s timeout

        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                signal: ctrl.signal
            });

            if (res.status === 204 || res.status === 404) return null;
            if (!res.ok) {
                const t = await res.text().catch(() => '');
                throw new Error(`API ${res.status}: ${t || 'unknown error'}`);
            }

            const data = await res.json().catch(() => ({}));
            if (!data) return null;

            // Your API: { url: "<presigned>", id: 7 }
            if (typeof data === 'string') return { url: data };
            if (data.url)    return { url: data.url,    id: data.id, filename: data.filename || data.name || null };
            if (data.s3_url) return { url: data.s3_url, id: data.id, filename: data.filename || data.name || null };

            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    async _updatePdfStatusPrinted(apiId, token) {
        if (!apiId) return false;

        const url = 'http://18.228.150.85/api/updatePdfStatus';
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 15000); // 15s timeout

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ id: apiId, status: 'Impresso' }),
                signal: ctrl.signal
            });

            if (!res.ok) {
                const t = await res.text().catch(() => '');
                throw new Error(`API ${res.status}: ${t || 'unknown error'}`);
            }

            this._emitLog(`[Queue] Status atualizado p/ Impresso (id=${apiId}).`);
            return true;
        } catch (e) {
            this._emitLog(`[Queue] Falha ao atualizar status (id=${apiId}): ${e?.message || e}`);
            return false;
        } finally {
            clearTimeout(timeout);
        }
    }

}

module.exports = QueueService;
