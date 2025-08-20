const sel = (id) => document.getElementById(id);
const printerSelect = sel('printer');
const refreshBtn = sel('refreshPrinters');
const refreshInfo = sel('refreshInfo');
const pdfPathInput = sel('pdfPath');
const printBtn = sel('printBtn');
const stopBtn = sel('stopBtn');
const statusEl = sel('status');
const jobInfoEl = sel('jobInfo');
const logEl = sel('log');
const tickerEl = sel('ticker');

let removeTickListener = null;
const jobBoxes = new Map();

function log(msg, cls='') {
    const ts = new Date().toLocaleTimeString();
    logEl.innerHTML += `[${ts}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
    if (cls) statusEl.className = `status ${cls}`;
}

/* ===== Ticker helpers: one box per job, prepend on the left ===== */
function statusClassFromInternal(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'printed')  return 'success';   // green
    if (s === 'printing') return 'printing';  // yellow
    if (s === 'deleted' || s === 'deleting') return 'deleted'; // red
    if (s === 'paused')   return 'paused';    // gray
    if (s === 'waiting')  return 'waiting';   // light
    if (s === 'retained') return 'retained';  // blue
    return '';
}

function getOrCreateJobBox(jobId) {
    const key = String(jobId);
    if (jobBoxes.has(key)) return jobBoxes.get(key);

    const el = document.createElement('div');
    el.className = 'tick';
    el.dataset.jobId = key;

    // PREPEND to the left
    if (tickerEl.firstChild) {
        tickerEl.insertBefore(el, tickerEl.firstChild);
    } else {
        tickerEl.appendChild(el);
    }

    jobBoxes.set(key, el);
    return el;
}

function renderJobBox(jobId, { statusInternal, labelOverride }) {
    const el = getOrCreateJobBox(jobId);

    // wipe old color classes
    el.classList.remove('success','printing','deleted','paused','waiting','retained');

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

/* ===== Printers (with retry/backoff) ===== */
async function loadPrinters() {
    const printers = await window.PrintAPI.getPrinters();
    printerSelect.innerHTML = '';
    (printers || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name}${p.isDefault ? ' (default)' : ''}`;
        printerSelect.appendChild(opt);
    });
    refreshInfo.textContent = `Loaded ${printers?.length || 0} printers.`;
    log(`Loaded ${printers?.length || 0} printers.`);
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
                refreshInfo.textContent = `Retry ${i + 1}/${attempts} in ${Math.ceil(wait / 1000)}s...`;
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

refreshBtn.addEventListener('click', () => {
    loadPrintersWithBackoff({ attempts: 5, baseDelay: 400, factor: 1.8, jitter: true });
});

/* ===== Print & watch ===== */
printBtn.addEventListener('click', async () => {
    const printerName = printerSelect.value;
    const pdfPath = pdfPathInput.value;

    if (!printerName) {
        log('Select a printer first', 'err');
        return;
    }

    // subscribe to status ticks (one at a time)
    if (removeTickListener) removeTickListener();
    removeTickListener = window.PrintAPI.onStatusTick(({ jobId, status }) => {
        renderJobBox(jobId, { statusInternal: status });
    });

    log(`Sending "${pdfPath}" to "${printerName}"...`);
    statusEl.textContent = 'Spooling...';
    statusEl.className = 'status';

    const sent = await window.PrintAPI.printPdf(printerName, pdfPath);
    if (!sent.success) {
        log(`Print error: ${sent.message}`, 'err');
        statusEl.textContent = 'Error';
        statusEl.className = 'status err';
        return;
    }

    log('Print sent. Looking up latest job...');
    setTimeout(async () => {
        const res = await window.PrintAPI.fetchLatestJob(printerName);
        if (!res.success) {
            log(`Could not fetch latest job: ${res.message}`, 'err');
            return;
        }
        if (!res.job) {
            log('No jobs found in queue (may have printed too fast). Declaring success.');
            statusEl.textContent = 'Printed successfully';
            statusEl.className = 'status ok';
            jobInfoEl.textContent = '—';
            return;
        }

        const job = res.job;
        const id  = job.Id || job.ID || job.id;

        // prefer the stringified status added by PowerShell: JobStatusText
        const raw = job.JobStatusText || job.JobStatus || job.jobStatus || 'Unknown';

        const internal = psStatusToInternal(raw);
        const pretty   = friendlyFromInternal(internal);

        // ensure the job box exists right away and shows initial status
        renderJobBox(id, { statusInternal: internal });

        jobInfoEl.textContent = `ID=${id}, Status=${pretty}, Doc=${job.Document || ''}`;
        statusEl.textContent  = `Tracking... (${pretty})`;

        const outcome = await window.PrintAPI.watchJob(printerName, id);

        if (outcome.success) {
            if (outcome.state === 'printed') {
                statusEl.textContent = 'Printed successfully';
                statusEl.className = 'status ok';
                log('Printed successfully ✅');

                // finalize box as green/white with final label
                renderJobBox(id, { statusInternal: 'printed', labelOverride: 'Printed successfully ✅' });

            } else if (outcome.state === 'deleted') {
                statusEl.textContent = 'Deleted successfully';
                statusEl.className = 'status warn';
                log('Deleted successfully 🗑️');

                // finalize box as red with final label
                renderJobBox(id, { statusInternal: 'deleted', labelOverride: 'Deleted successfully' });

            } else {
                statusEl.textContent = 'Done';
                log(`Done: ${outcome.state}`);
                renderJobBox(id, { statusInternal: outcome.state });
            }
        } else {
            statusEl.textContent = 'Watch error';
            statusEl.className = 'status err';
            log(`Watch error: ${outcome.message || 'unknown'}`, 'err');
        }
    }, 800);
});

stopBtn.addEventListener('click', async () => {
    await window.PrintAPI.stopWatch();
    statusEl.textContent = 'Stopped';
    statusEl.className = 'status warn';
    log('Stopped watching.');
    if (removeTickListener) { removeTickListener(); removeTickListener = null; }
});

/* ===== Status label helpers ===== */
function friendlyFromInternal(status) {
    switch (String(status || '').toLowerCase()) {
        case 'waiting':  return 'Waiting printing';
        case 'paused':   return 'Paused';
        case 'deleting': return 'Deleting';
        case 'retained': return 'Retained';
        case 'printing': return 'Printing';
        case 'printed':  return 'Printed successfully ✅';
        case 'deleted':  return 'Deleted successfully';
        default:         return status || 'Unknown';
    }
}

function psStatusToInternal(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('deleting')) return 'Deleting';
    if (s.includes('paused'))   return 'Paused';
    if (s.includes('printing') || s.includes('spooling') || s.includes('processing')) return 'Printing';
    if (s.includes('retained')) return 'Retained';
    if (s.includes('normal'))   return 'Waiting';
    return 'Unknown';
}

/* ===== Init ===== */
initialLoadPrinters();
