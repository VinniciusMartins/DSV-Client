const { spawn } = require('child_process');

function runPS(psCommand) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-Command', psCommand
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (d) => (stdout += d.toString()));
        ps.stderr.on('data', (d) => (stderr += d.toString()));
        ps.on('error', reject);
        ps.on('close', (code) => {
            if (code !== 0 && !stdout.trim()) {
                return reject(new Error(stderr || `PowerShell exited ${code}`));
            }
            resolve(stdout);
        });
    });
}

class PowerShellService {
    // Add JobStatusText (string) to avoid empty/flaggy JobStatus issues
    async getLatestPrintJob(printerName) {
        const cmd = `
$ErrorActionPreference="SilentlyContinue";
$p='${printerName.replace(/'/g, "''")}';
$j=Get-PrintJob -PrinterName $p |
   Sort-Object SubmitTime -Descending |
   Select-Object -First 1 Id,Document,UserName,JobStatus,PagesPrinted,TotalPages,SubmitTime,Position |
   ForEach-Object { $_ | Add-Member -NotePropertyName JobStatusText -NotePropertyValue ([string]$_.JobStatus) -Force; $_ } |
   ConvertTo-Json -Compress;
$j
`.trim();
        const out = await runPS(cmd);
        const s = out.trim();
        if (!s) return null;
        try { return JSON.parse(s); } catch { return null; }
    }

    async getJobById(printerName, id) {
        const cmd = `
$ErrorActionPreference="SilentlyContinue";
$p='${printerName.replace(/'/g, "''")}';
$i=${Number(id)};
$j=Get-PrintJob -PrinterName $p -Id $i |
   Select-Object Id,Document,UserName,JobStatus,PagesPrinted,TotalPages,Position |
   ForEach-Object { $_ | Add-Member -NotePropertyName JobStatusText -NotePropertyValue ([string]$_.JobStatus) -Force; $_ } |
   ConvertTo-Json -Compress;
$j
`.trim();
        const out = await runPS(cmd).catch(() => '');
        const s = out.trim();
        if (!s) return null;
        try { return JSON.parse(s); } catch { return null; }
    }
}

module.exports = PowerShellService;
