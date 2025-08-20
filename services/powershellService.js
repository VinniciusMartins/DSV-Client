// services/powerShellService.js
// Cross-version PowerShell launcher + helpers for querying Windows print jobs.
// - Prefers installed PowerShell 7 (C:\Program Files\PowerShell\7\pwsh.exe)
// - Falls back to bundled portable pwsh (resources/pwsh/pwsh.exe) if present
// - Falls back to Windows PowerShell 5.1 (System32\WindowsPowerShell\v1.0\powershell.exe)
// - Last resort: 'powershell.exe' via PATH
//
// Exposes:
//   run(command: string) -> Promise<string>
//   getLatestPrintJob(printerName: string) -> Promise<object|null>
//   getJobById(printerName: string, id: number) -> Promise<object|null>
//
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolvePwshPath() {
    // 1) Installed PowerShell 7
    const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    if (fs.existsSync(ps7)) {
        return { cmd: ps7, argsBase: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
    }

    // 2) Bundled portable PowerShell 7 inside the app (electron-builder extraResources)
    //    During production, process.resourcesPath points to "<app>\resources"
    //    In dev, fall back to project root.
    const resourcesRoot = process.resourcesPath || process.cwd();
    const bundled = path.join(resourcesRoot, 'pwsh', 'pwsh.exe');
    if (fs.existsSync(bundled)) {
        return { cmd: bundled, argsBase: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
    }

    // 3) Windows PowerShell 5.1 (handle 32-bit node on 64-bit OS using Sysnative)
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const isWOW64 = !!process.env.PROCESSOR_ARCHITEW6432 || !!process.env['ProgramFiles(x86)'];
    const systemDir = path.join(sysRoot, isWOW64 ? 'Sysnative' : 'System32');
    const ps51 = path.join(systemDir, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(ps51)) {
        return { cmd: ps51, argsBase: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
    }

    // 4) PATH fallback
    return { cmd: 'powershell.exe', argsBase: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
}

function escapePsString(s) {
    // Escape for inclusion in double-quoted PowerShell strings
    return String(s || '').replace(/`/g, '``').replace(/"/g, '""');
}

class PowerShellService {
    constructor() {
        const { cmd, argsBase } = resolvePwshPath();
        this.psCmd = cmd;
        this.argsBase = argsBase;
    }

    run(command) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.psCmd, [...this.argsBase, command], { windowsHide: true });
            let out = '', err = '';
            child.stdout.on('data', d => out += d.toString());
            child.stderr.on('data', d => err += d.toString());
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) return resolve(out.trim());
                // Some PowerShell providers write to stderr even on success; if stdout has JSON, prefer it.
                if (out.trim()) return resolve(out.trim());
                reject(new Error(err.trim() || `PowerShell exited with code ${code}`));
            });
        });
    }

    /**
     * Return latest job for a given printer as a JSON object (or null).
     * Tries PrintManagement:Get-PrintJob first; falls back to WMI:Win32_PrintJob.
     */
    async getLatestPrintJob(printerName) {
        const p = escapePsString(printerName);

        // PrintManagement path
        const scriptPM = `
Try {
  $p = "${p}";
  $j = Get-PrintJob -PrinterName $p | Sort-Object -Property TimeSubmitted -Descending | Select-Object -First 1
  if ($j) {
    $status = $j.JobStatus
    if ($status -is [array]) { $status = ($status -join ", ") }
    elseif ($status) { $status = [string]$status }
    else { $status = "" }
    Add-Member -InputObject $j -NotePropertyName JobStatusText -NotePropertyValue $status -Force
    $j | ConvertTo-Json -Compress -Depth 6
  } else { "" }
} Catch {
  ""  # fall through to WMI
}
`.trim();

        // Try PM first
        let raw = await this.run(scriptPM).catch(() => '');
        if (raw && raw !== '""') {
            try { return JSON.parse(raw); } catch {/* continue */}
        }

        // WMI fallback
        const scriptWMI = `
Try {
  $p = "${p}";
  $jobs = Get-WmiObject Win32_PrintJob | Where-Object {
    # Win32_PrintJob.Name is "PrinterName, Job X"
    $_.Name -like "$p,*"
  }
  if ($jobs) {
    $j = $jobs | Sort-Object -Property TimeSubmitted -Descending | Select-Object -First 1
    if ($j) {
      $status = $j.Status
      if ($status -is [array]) { $status = ($status -join ", ") }
      elseif ($status) { $status = [string]$status } else { $status = "" }
      $out = [pscustomobject]@{
        Id            = $j.JobId
        ID            = $j.JobId
        Document      = $j.Document
        UserName      = $j.Owner
        JobStatus     = $status
        JobStatusText = $status
        PagesPrinted  = $j.PagesPrinted
        TotalPages    = $j.TotalPages
      }
      $out | ConvertTo-Json -Compress -Depth 6
    } else { "" }
  } else { "" }
} Catch {
  ""
}
`.trim();

        raw = await this.run(scriptWMI).catch(() => '');
        if (!raw || raw === '""') return null;
        try { return JSON.parse(raw); } catch { return null; }
    }

    /**
     * Return specific job by ID for a given printer (object or null).
     * Tries PrintManagement first; falls back to WMI.
     */
    async getJobById(printerName, id) {
        const p = escapePsString(printerName);
        const j = Number(id) || 0;

        const scriptPM = `
Try {
  $p = "${p}"
  $id = ${j}
  $j = Get-PrintJob -PrinterName $p -ID $id | Select-Object *
  if ($j) {
    $status = $j.JobStatus
    if ($status -is [array]) { $status = ($status -join ", ") }
    elseif ($status) { $status = [string]$status } else { $status = "" }
    Add-Member -InputObject $j -NotePropertyName JobStatusText -NotePropertyValue $status -Force
    $j | ConvertTo-Json -Compress -Depth 6
  } else { "" }
} Catch { "" }
`.trim();

        let raw = await this.run(scriptPM).catch(() => '');
        if (raw && raw !== '""') {
            try { return JSON.parse(raw); } catch {/* continue */}
        }

        const scriptWMI = `
Try {
  $p = "${p}"
  $id = ${j}
  $j = Get-WmiObject Win32_PrintJob | Where-Object {
    $_.JobId -eq $id -and $_.Name -like "$p,*"
  } | Select-Object -First 1
  if ($j) {
    $status = $j.Status
    if ($status -is [array]) { $status = ($status -join ", ") }
    elseif ($status) { $status = [string]$status } else { $status = "" }
    $out = [pscustomobject]@{
      Id            = $j.JobId
      ID            = $j.JobId
      Document      = $j.Document
      UserName      = $j.Owner
      JobStatus     = $status
      JobStatusText = $status
      PagesPrinted  = $j.PagesPrinted
      TotalPages    = $j.TotalPages
    }
    $out | ConvertTo-Json -Compress -Depth 6
  } else { "" }
} Catch { "" }
`.trim();

        raw = await this.run(scriptWMI).catch(() => '');
        if (!raw || raw === '""') return null;
        try { return JSON.parse(raw); } catch { return null; }
    }
}

module.exports = PowerShellService;
