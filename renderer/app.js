// renderer/app.js
const sel = (id) => document.getElementById(id);

const printerSelect   = sel('printer');
const refreshBtn      = sel('refreshPrinters');
const refreshInfo     = sel('refreshInfo');

const listenStartBtn  = sel('listenStartBtn');
const listenStopBtn   = sel('listenStopBtn');
const reprintBtn      = sel('reprintBtn');
const queueStateBadge = sel('queueStateBadge');

const statusEl  = sel('status');   // "Tracking status" label element
const jobInfoEl = sel('jobInfo');  // "Latest job" line element
const logEl     = sel('log');
const tickerEl  = sel('ticker');   // LIVE JOBS container

let removeTickListener = null;
const jobBoxes = new Map();
const tickLineNodes = new Map(); // one console line per job

const zebraPrinterSelect = sel('zebraPrinter');
const zebraListenSwitch = sel('zebraListenSwitch');
const zebraQueueBadge = sel('zebraQueueBadge');

let zebraListenToken = null; // { stop: boolean }
let zebraLoopPromise = null;
let zebraIdleLogged = false;

/* ---------- Log & Ticker helpers ---------- */
function log(msg, cls='') {
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = `[${ts}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    if (cls) statusEl.className = `status ${cls}`;
}

// live-updating console line for each jobId
function logTick(jobId, status) {
    const key = String(jobId);
    const ts = new Date().toLocaleTimeString();
    const pretty = friendlyFromInternal(status);

    let node = tickLineNodes.get(key);
    if (!node) {
        node = document.createElement('div');
        node.className = 'log-line tick-line';
        logEl.appendChild(node);
        tickLineNodes.set(key, node);
    }
    node.textContent = `[${ts}] [Tick] jobId=${key}, ${pretty}`;
    logEl.scrollTop = logEl.scrollHeight;
}

function statusClassFromInternal(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'printed')  return 'success';
    if (s === 'printing') return 'printing';
    if (s === 'deleted' || s === 'deleting') return 'deleted';
    if (s === 'paused')   return 'paused';
    if (s === 'waiting')  return 'waiting';
    if (s === 'retained') return 'retained';
    if (s === 'unknown')  return 'unknown';
    return '';
}

function getOrCreateJobBox(jobId) {
    const key = String(jobId);
    if (jobBoxes.has(key)) return jobBoxes.get(key);
    const el = document.createElement('div');
    el.className = 'tick';
    el.dataset.jobId = key;
    if (tickerEl.firstChild) tickerEl.insertBefore(el, tickerEl.firstChild);
    else tickerEl.appendChild(el);
    jobBoxes.set(key, el);
    return el;
}

function renderJobBox(jobId, { statusInternal, labelOverride }) {
    const el = getOrCreateJobBox(jobId);
    // include 'unknown' so classes don't stack when state changes
    el.classList.remove('success','printing','deleted','paused','waiting','retained','unknown');
    const cls = statusClassFromInternal(statusInternal);
    if (cls) el.classList.add(cls);
    const ts = new Date().toLocaleTimeString();
    const pretty = labelOverride || friendlyFromInternal(statusInternal);
    el.innerHTML = `
    <span class="ts">${ts}</span>
    <span class="label">Job #${jobId}</span><br/>
    <span>${pretty}</span>
  `;
}

/* ---------- Printer discovery (with backoff) ---------- */
async function loadPrinters() {
    const printers = await window.PrintAPI.getPrinters();
    const list = Array.isArray(printers) ? printers : [];

    const prevQueuePrinter = printerSelect?.value || '';
    const prevZebraPrinter = zebraPrinterSelect?.value || '';

    const resolveName = (p) => p?.name || 'Unnamed printer';

    if (printerSelect) {
        printerSelect.innerHTML = '';
    }
    if (zebraPrinterSelect) {
        zebraPrinterSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select Zebra printer';
        placeholder.disabled = true;
        placeholder.hidden = true;
        zebraPrinterSelect.appendChild(placeholder);
    }

    let zebraPreselect = prevZebraPrinter;
    if (!zebraPreselect) {
        const zebraCandidate = list.find(p => /zebra|zd|zpl/i.test(resolveName(p)));
        if (zebraCandidate) zebraPreselect = resolveName(zebraCandidate);
    }

    if (zebraPrinterSelect) {
        const placeholder = zebraPrinterSelect.querySelector('option[value=""]');
        if (placeholder) placeholder.selected = !zebraPreselect;
    }

    list.forEach(p => {
        const name = resolveName(p);
        if (printerSelect) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name}${p?.isDefault ? ' (default)' : ''}`;
            if (prevQueuePrinter && prevQueuePrinter === name) opt.selected = true;
            printerSelect.appendChild(opt);
        }

        if (zebraPrinterSelect) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name}${/zebra|zd|zpl/i.test(name) ? ' 🦓' : ''}`;
            if ((prevZebraPrinter && prevZebraPrinter === name) || (!prevZebraPrinter && zebraPreselect === name)) {
                opt.selected = true;
            }
            zebraPrinterSelect.appendChild(opt);
        }
    });

    if (zebraPrinterSelect && !zebraPrinterSelect.value) {
        zebraPrinterSelect.selectedIndex = 0;
    }

    syncZebraToggleAvailability();

    refreshInfo.textContent = `Loaded ${list.length} printers.`;
    log(`Loaded ${list.length} printers.`);
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function loadPrintersWithBackoff({ attempts = 5, baseDelay = 400, factor = 1.8, jitter = true } = {}) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            refreshInfo.textContent = `Loading printers (attempt ${i}/${attempts})...`;
            await loadPrinters();
            return;
        } catch (e) {
            lastErr = e;
            if (i < attempts) {
                const wait = Math.floor(baseDelay * Math.pow(factor, i - 1)) + (jitter ? Math.floor(Math.random() * 150) : 0);
                refreshInfo.textContent = `Retry ${i + 1}/${attempts} in ${Math.ceil(wait/1000)}s...`;
                await delay(wait);
            }
        }
    }
    refreshInfo.textContent = 'Failed to load printers.';
    log(`Failed to load printers: ${lastErr?.message || 'unknown'}`, 'err');
}
async function initialLoadPrinters() {
    await loadPrintersWithBackoff({ attempts: 3, baseDelay: 300, factor: 2.0, jitter: true });
}
refreshBtn?.addEventListener('click', () => {
    loadPrintersWithBackoff({ attempts: 5, baseDelay: 400, factor: 1.8, jitter: true });
});

/* ---------- Auth token helper ---------- */
async function getAuthToken() {
    try {
        const res = await window.AuthAPI.getUser();
        return res?.token || null;
    } catch { return null; }
}

async function getApiBaseUrl() {
    try {
        const res = await window.AuthAPI.getUser();
        if (res?.baseUrl) return res.baseUrl.replace(/\/+$/, '');
    } catch {}
    try {
        const res = await window.AuthAPI?.getBaseUrl?.();
        if (res?.baseUrl) return res.baseUrl.replace(/\/+$/, '');
    } catch {}
    return 'https://www.apinfautprd.com/api';
}

/* ---------- Status translation ---------- */
function friendlyFromInternal(status) {
    switch (String(status || '').toLowerCase()) {
        case 'waiting':  return 'Waiting printing';
        case 'paused':   return 'Paused';
        case 'deleting': return 'Deleting';
        case 'retained': return 'Retained';
        case 'printing': return 'Printing';
        case 'printed':  return 'Printed successfully ✅';
        case 'deleted':  return 'Deleted successfully';
        case 'unknown':  return 'Check printer';
        default:         return status || 'Unknown';
    }
}

/* ---------- Ticks: update LIVE JOBS + header + single-line console ---------- */
if (removeTickListener) removeTickListener();
removeTickListener = window.PrintAPI.onStatusTick(({ jobId, status }) => {
    // LIVE JOBS
    renderJobBox(jobId, { statusInternal: status });

    // Console (one row per jobId)
    logTick(jobId, status);

    // Header
    const pretty = friendlyFromInternal(status);
    const idText = (jobId === 'instant' || jobId === 'reprint') ? '—' : jobId;
    jobInfoEl.textContent = `ID=${idText}, Status=${pretty}`;

    const s = String(status || '').toLowerCase();
    if (s === 'printed') {
        statusEl.textContent = 'Printed successfully';
        statusEl.className = 'status ok';
    } else if (s === 'deleted') {
        statusEl.textContent = 'Deleted successfully';
        statusEl.className = 'status warn';
    } else if (s === 'paused') {
        statusEl.textContent = 'Paused';
        statusEl.className = 'status warn';
    } else if (s === 'unknown') {
        statusEl.textContent = 'Check printer';
        statusEl.className = 'status err';
    } else {
        statusEl.textContent = `Tracking... (${pretty})`;
        statusEl.className = 'status';
    }
});

/* ---------- Queue state + logs ---------- */
window.QueueAPI?.onState?.(({ state, printerName, reason, jobId }) => {
    const map = {
        listening:        'Queue: listening',
        tracking:         'Queue: tracking…',
        'paused-tracking':'Queue: paused (tracking…)',
        stopping:         'Queue: stopping…',
        stopped:          `Queue: stopped${reason ? ' (' + reason + ')' : ''}`
    };
    queueStateBadge.textContent = map[state] || `Queue: ${state}`;

    // Gentle UI hints per state (won't fight with tick updates)
    if (state === 'listening') {
        statusEl.textContent = 'Listening for jobs…';
        statusEl.className = 'status';
        jobInfoEl.textContent = '—';
    } else if (state === 'tracking') {
        statusEl.textContent = 'Tracking current job…';
        statusEl.className = 'status';
    } else if (state === 'paused-tracking') {
        statusEl.textContent = 'Paused (tracking…)';
        statusEl.className = 'status warn';
    } else if (state === 'stopping') {
        statusEl.textContent = 'Stopping…';
        statusEl.className = 'status';
    } else if (state === 'stopped') {
        statusEl.textContent = 'Stopped';
        statusEl.className = 'status warn';
    }
});

window.QueueAPI?.onLog?.(({ msg }) => {
    log(`[Q] ${msg}`);
});

/* ---------- Queue controls ---------- */
listenStartBtn?.addEventListener('click', async () => {
    const printerName = printerSelect.value;
    if (!printerName) { log('Select a printer first', 'err'); return; }
    queueStateBadge.textContent = 'Queue: starting…';
    await window.QueueAPI.stop(); // ensure stopped before retry
    const token = await getAuthToken();
    const r = await window.QueueAPI.start(printerName, token);
    if (r?.success) log('Queue listening started.');
});

listenStopBtn?.addEventListener('click', async () => {
    queueStateBadge.textContent = 'Queue: stopping…';
    const r = await window.QueueAPI.stop();
    if (r?.success) log('Queue listening stopped.');
});

reprintBtn?.addEventListener('click', async () => {
    const printerName = printerSelect.value;
    if (!printerName) { log('Select a printer first', 'err'); return; }
    queueStateBadge.textContent = 'Queue: stopping…';
    await window.QueueAPI.stop('reprint'); // stop auto before retry
    const r = await window.QueueAPI.reprintLast(printerName);
    if (!r?.success) {
        log(`Reprint failed: ${r?.message || 'unknown'}`, 'err');
        return;
    }
    log(`Reprint outcome: ${r.state || 'done'}`);
});

function setZebraBadge(state, reason = '') {
    if (!zebraQueueBadge) return;
    const map = {
        idle: 'Zebra: idle',
        listening: 'Zebra: listening…',
        printing: 'Zebra: printing…',
        stopped: `Zebra: stopped${reason ? ` (${reason})` : ''}`
    };
    zebraQueueBadge.textContent = map[state] || `Zebra: ${state}`;
}

function syncZebraToggleAvailability() {
    const hasPrinter = !!(zebraPrinterSelect?.value || '').trim();
    if (!zebraListenSwitch) return;
    zebraListenSwitch.disabled = !hasPrinter;
    if (!hasPrinter && zebraListenSwitch.checked) {
        zebraListenSwitch.checked = false;
    }
    if (!hasPrinter) {
        stopZebraListening('no-printer');
        setZebraBadge('idle');
    }
}

async function fetchNextZebraJob(baseUrl, token) {
    const url = `${baseUrl}/zebra/zebraQueue`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            signal: ctrl.signal
        });

        const text = await res.text();
        if (res.status === 204 || res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || 'unknown error'}`);
        if (!text) return null;

        let fallback = text;
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed === 'string') fallback = parsed;
            else if (parsed && typeof parsed === 'object') {
                const zpl = parsed.zpl || parsed.label || '';
                return { zpl, id: parsed.id, name: parsed.name || parsed.filename || parsed.labelName, filename: parsed.filename };
            }
        } catch { /* payload not JSON */ }

        return { zpl: fallback };
    } finally {
        clearTimeout(timeout);
    }
}

async function processZebraJob(job, printerName, baseUrl, token) {
    const zpl = String(job?.zpl || '').trim();
    if (!zpl) { log('[Zebra] Empty ZPL payload; skipping.', 'err'); await delay(500); return; }

    const label = job?.filename || job?.name || job?.id || 'label';
    setZebraBadge('printing');
    log(`[Zebra] Printing ${label}…`);

    const res = await window.ZebraAPI.printUsb(printerName, zpl);
    const success = !!res?.success;

    if (success) log(`[Zebra] Printed ${label}.`);
    else log(`[Zebra] Print failed: ${res?.message || 'unknown'}`, 'err');

    if (success && job?.id) {
        await updateZebraStatusPrinted(baseUrl, token, job.id);
    }

    setZebraBadge('listening');
    await delay(success ? 800 : 400);
}

async function updateZebraStatusPrinted(baseUrl, token, apiId) {
    if (!apiId) return false;

    const url = `${baseUrl}/updateZebraStatus`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ id: apiId, status: 'Impresso' }),
            signal: ctrl.signal
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${txt || 'unknown error'}`);
        }

        log(`[Zebra] Status atualizado p/ Impresso (id=${apiId}).`);
        return true;
    } catch (err) {
        log(`[Zebra] Falha ao atualizar status (id=${apiId}): ${err?.message || err}`, 'err');
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function startZebraListening() {
    const printerName = (zebraPrinterSelect?.value || '').trim();
    if (!printerName) { if (zebraListenSwitch) zebraListenSwitch.checked = false; log('Select a Zebra printer first', 'err'); return; }
    if (zebraListenToken) return;

    const token = await getAuthToken();
    const baseUrl = await getApiBaseUrl();
    zebraListenToken = { stop: false };
    zebraIdleLogged = false;
    setZebraBadge('listening');
    log('[Zebra] Listening for labels…');

    zebraLoopPromise = (async () => {
        while (!zebraListenToken.stop) {
            let job = null;
            try {
                job = await fetchNextZebraJob(baseUrl, token);
            } catch (err) {
                log(`[Zebra] API error: ${err?.message || err}`, 'err');
                await delay(2000);
                continue;
            }

            if (zebraListenToken.stop) break;
            if (!job || !job.zpl) {
                setZebraBadge('idle');
                if (!zebraIdleLogged) {
                    log('[Zebra] Queue idle.');
                    zebraIdleLogged = true;
                }
                await delay(1400);
                continue;
            }
            zebraIdleLogged = false;

            await processZebraJob(job, printerName, baseUrl, token);
        }
    })().finally(() => {
        setZebraBadge('stopped', zebraListenToken?.stop ? 'manual' : 'done');
        zebraListenToken = null;
        zebraLoopPromise = null;
        if (zebraListenSwitch) zebraListenSwitch.checked = false;
        log('[Zebra] Listener stopped.');
    });
}

async function stopZebraListening(reason = 'manual') {
    if (!zebraListenToken) { setZebraBadge('stopped', reason); return; }
    zebraListenToken.stop = true;
    if (zebraLoopPromise) await zebraLoopPromise;
    setZebraBadge('stopped', reason);
}

zebraListenSwitch?.addEventListener('change', (evt) => {
    if (evt.target.checked) startZebraListening();
    else stopZebraListening('toggle-off');
});

zebraPrinterSelect?.addEventListener('change', () => {
    syncZebraToggleAvailability();
});

/* ---------- Init ---------- */
initialLoadPrinters();
syncZebraToggleAvailability();
