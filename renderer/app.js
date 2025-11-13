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
const testZebraBtn = sel('testZebraBtn');

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

async function testZebraPrint() {
    const printerName = (zebraPrinterSelect?.value || '').trim();
    if (!printerName) { log('Select a Zebra printer first', 'err'); return; }

    const baseUrl = await getApiBaseUrl();
    const url = `${baseUrl}/zebra/zebraQueue`;

    try {
        log(`Fetching ZPL from ${url} ...`);
        const token = await getAuthToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(url, { headers });
        if (!res.ok) {
            log(`ZPL fetch failed: HTTP ${res.status}`, 'err');
            return;
        }
        const payload = await res.text();
        let zpl = payload;
        try {
            const parsed = JSON.parse(payload);
            if (typeof parsed === 'string') zpl = parsed;
            else if (parsed && typeof parsed === 'object') {
                if (typeof parsed.zpl === 'string') zpl = parsed.zpl;
                else if (typeof parsed.label === 'string') zpl = parsed.label;
            }
        } catch {/* payload not JSON; treat as raw ZPL */}

        zpl = (zpl || '').trim();
        if (!zpl) {
            log('ZPL fetch succeeded but payload was empty.', 'err');
            return;
        }
        log(`Sending ZPL to ${printerName} (raw USB)...`);

        const r = await window.ZebraAPI.printUsb(printerName, zpl);
        if (r?.success) log(`✅ Zebra printed successfully on ${printerName}`);
        else log(`❌ Print failed: ${r?.message || 'unknown'}`, 'err');
    } catch (err) {
        log(`❌ Error: ${err.message}`, 'err');
    }
}

testZebraBtn?.addEventListener('click', testZebraPrint);

/* ---------- Init ---------- */
initialLoadPrinters();
