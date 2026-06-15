// ============================================================
// Pecifics OS Tasks Module
// All Windows system-level operations, Win+R tasks,
// cache clearing, services, startup, registry, networking
// ============================================================

const { exec, execFile } = require('child_process');
const path = require('path');
const os   = require('os');

// Convenience: promisified exec with generous buffer
function ps(script, opts = {}) {
    return new Promise((resolve) => {
        const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${
            script.replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
        }"`;
        exec(cmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000, ...opts }, (err, stdout, stderr) => {
            const out = (stdout || '').trim();
            if (err && !out) {
                resolve({ success: false, error: err.message, stderr: (stderr || '').trim() });
            } else {
                resolve({ success: true, output: out, stderr: (stderr || '').trim() });
            }
        });
    });
}

// Convenience: inline exec for simple commands
function shell(command, opts = {}) {
    return new Promise((resolve) => {
        exec(command, { maxBuffer: 1024 * 1024 * 5, timeout: 30000, ...opts }, (err, stdout, stderr) => {
            resolve({
                success: !err,
                output: (stdout || '').trim(),
                error : err ? err.message : null,
                stderr: (stderr || '').trim(),
            });
        });
    });
}

class OSTasks {

    // ──────────────────────────────────────────────────────
    // RUN DIALOG (Win+R equivalent)
    // ──────────────────────────────────────────────────────

    /**
     * Execute any Win+R / Run dialog command
     * @param {string} command  e.g. "msconfig", "services.msc", "devmgmt.msc", "regedit"
     */
    async runWinR(command) {
        return shell(`start "" ${command}`);
    }

    // Aliases for common Win+R commands
    async openMsconfig()      { return this.runWinR('msconfig'); }
    async openServices()      { return this.runWinR('services.msc'); }
    async openDeviceManager() { return this.runWinR('devmgmt.msc'); }
    async openDiskMgmt()      { return this.runWinR('diskmgmt.msc'); }
    async openRegedit()       { return this.runWinR('regedit'); }
    async openEventViewer()   { return this.runWinR('eventvwr.msc'); }
    async openTaskScheduler() { return this.runWinR('taskschd.msc'); }
    async openGroupPolicy()   { return this.runWinR('gpedit.msc'); }
    async openPerfMon()       { return this.runWinR('perfmon'); }
    async openResMonitor()    { return this.runWinR('resmon'); }
    async openSystemInfo()    { return this.runWinR('msinfo32'); }
    async openDxDiag()        { return this.runWinR('dxdiag'); }
    async openCertMgr()       { return this.runWinR('certmgr.msc'); }
    async openComputerMgmt()  { return this.runWinR('compmgmt.msc'); }
    async openFirewall()      { return this.runWinR('wf.msc'); }
    async openNetworkConns()  { return this.runWinR('ncpa.cpl'); }
    async openSoundSettings() { return this.runWinR('mmsys.cpl'); }
    async openMouseSettings() { return this.runWinR('main.cpl'); }
    async openDisplaySettings(){ return shell('start ms-settings:display'); }
    async openWindowsUpdate()  { return shell('start ms-settings:windowsupdate'); }
    async openAppsSettings()   { return shell('start ms-settings:appsfeatures'); }
    async openPrivacySettings(){ return shell('start ms-settings:privacy'); }
    async openPowerOptions()   { return this.runWinR('powercfg.cpl'); }
    async openProgramsAndFeatures() { return this.runWinR('appwiz.cpl'); }
    async openSystemProps()    { return this.runWinR('sysdm.cpl'); }
    async openInternetOptions(){ return this.runWinR('inetcpl.cpl'); }
    async openUserAccounts()   { return this.runWinR('netplwiz'); }
    async openCredentialMgr()  { return this.runWinR('credwiz'); }
    async openAddPrinter()     { return shell('start ms-settings:printers'); }
    async openBluetooth()      { return shell('start ms-settings:bluetooth'); }

    // ──────────────────────────────────────────────────────
    // CACHE CLEARING
    // ──────────────────────────────────────────────────────

    /**
     * Clear Windows temp files
     */
    async clearWindowsTemp() {
        const script = `
            $paths = @("$env:TEMP", "$env:SystemRoot\\Temp", "$env:LOCALAPPDATA\\Temp")
            $freed = 0
            foreach ($p in $paths) {
                if (Test-Path $p) {
                    $before = (Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                    Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue
                    $after = (Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                    $freed += ($before - $after)
                }
            }
            $freedMB = [math]::Round($freed / 1MB, 2)
            Write-Output "Cleared Windows temp files. Freed approx $($freedMB) MB"
        `;
        return ps(script);
    }

    /**
     * Flush DNS resolver cache
     */
    async flushDns() {
        const result = await shell('ipconfig /flushdns');
        if (result.success || result.output.toLowerCase().includes('flush')) {
            return { success: true, message: '✅ DNS resolver cache flushed successfully.' };
        }
        return { success: false, error: result.error || 'DNS flush failed' };
    }

    /**
     * Clear ARP cache
     */
    async clearArpCache() {
        const result = await shell('arp -d *');
        return { success: true, message: 'ARP cache cleared.' };
    }

    /**
     * Clear Windows icon/thumbnail cache
     */
    async clearIconCache() {
        const script = `
            Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            $iconCache = "$env:LOCALAPPDATA\\IconCache.db"
            $thumbCache = "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer"
            if (Test-Path $iconCache) { Remove-Item $iconCache -Force -ErrorAction SilentlyContinue }
            if (Test-Path $thumbCache) { Remove-Item "$thumbCache\\thumbcache_*.db" -Force -ErrorAction SilentlyContinue }
            Start-Process explorer
            Write-Output "Icon and thumbnail cache cleared"
        `;
        return ps(script);
    }

    /**
     * Clear Windows font cache
     */
    async clearFontCache() {
        const script = `
            Stop-Service -Name "FontCache" -Force -ErrorAction SilentlyContinue
            Stop-Service -Name "FontCache3.0.0.0" -Force -ErrorAction SilentlyContinue
            $fontCache = "$env:SystemRoot\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache"
            if (Test-Path $fontCache) { Remove-Item "$fontCache\\*" -Force -ErrorAction SilentlyContinue }
            Start-Service -Name "FontCache" -ErrorAction SilentlyContinue
            Write-Output "Font cache cleared"
        `;
        return ps(script);
    }

    /**
     * Clear Windows Update cache
     */
    async clearWindowsUpdateCache() {
        const script = `
            Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
            Stop-Service -Name bits -Force -ErrorAction SilentlyContinue
            $path = "$env:SystemRoot\\SoftwareDistribution\\Download"
            if (Test-Path $path) { Remove-Item "$path\\*" -Recurse -Force -ErrorAction SilentlyContinue }
            Start-Service -Name wuauserv -ErrorAction SilentlyContinue
            Start-Service -Name bits -ErrorAction SilentlyContinue
            Write-Output "Windows Update cache cleared"
        `;
        return ps(script);
    }

    /**
     * Clear Chrome browser cache
     */
    async clearChromeCache() {
        const script = `
            $chromePath = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default"
            $paths = @(
                "$chromePath\\Cache",
                "$chromePath\\Code Cache",
                "$chromePath\\GPUCache",
                "$chromePath\\ScriptCache",
                "$chromePath\\Service Worker\\CacheStorage"
            )
            $count = 0
            foreach ($p in $paths) {
                if (Test-Path $p) {
                    Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue
                    $count++
                }
            }
            Write-Output "Chrome cache cleared ($count cache folders cleaned)"
        `;
        return ps(script);
    }

    /**
     * Clear Edge browser cache
     */
    async clearEdgeCache() {
        const script = `
            $edgePath = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default"
            $paths = @("$edgePath\\Cache", "$edgePath\\Code Cache", "$edgePath\\GPUCache")
            foreach ($p in $paths) {
                if (Test-Path $p) { Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue }
            }
            Write-Output "Edge cache cleared"
        `;
        return ps(script);
    }

    /**
     * Clear Firefox browser cache
     */
    async clearFirefoxCache() {
        const script = `
            $ffPath = "$env:APPDATA\\Mozilla\\Firefox\\Profiles"
            if (Test-Path $ffPath) {
                Get-ChildItem $ffPath -Directory | ForEach-Object {
                    $cache = Join-Path $_.FullName "cache2"
                    if (Test-Path $cache) { Remove-Item "$cache\\*" -Recurse -Force -ErrorAction SilentlyContinue }
                }
            }
            Write-Output "Firefox cache cleared"
        `;
        return ps(script);
    }

    /**
     * Master cache clearer
     * @param {string} cacheType  "temp"|"dns"|"browser"|"arp"|"icon"|"wupdate"|"all"
     */
    async clearCache(cacheType = 'all') {
        const type = (cacheType || 'all').toLowerCase();
        const results = [];

        const run = async (label, fn) => {
            try {
                const r = await fn();
                results.push({ label, success: r.success !== false, message: r.output || r.message || '' });
            } catch (e) {
                results.push({ label, success: false, message: e.message });
            }
        };

        if (type === 'temp' || type === 'all')    await run('Windows Temp',    () => this.clearWindowsTemp());
        if (type === 'dns'  || type === 'all')    await run('DNS Cache',       () => this.flushDns());
        if (type === 'arp'  || type === 'all')    await run('ARP Cache',       () => this.clearArpCache());
        if (type === 'icon' || type === 'all')    await run('Icon Cache',      () => this.clearIconCache());
        if (type === 'wupdate' || type === 'all') await run('WUpdate Cache',   () => this.clearWindowsUpdateCache());
        if (type === 'browser' || type === 'all') {
            await run('Chrome Cache', () => this.clearChromeCache());
            await run('Edge Cache',   () => this.clearEdgeCache());
            await run('Firefox Cache',() => this.clearFirefoxCache());
        }
        if (type === 'chrome') await run('Chrome Cache', () => this.clearChromeCache());
        if (type === 'edge')   await run('Edge Cache',   () => this.clearEdgeCache());
        if (type === 'firefox')await run('Firefox Cache',() => this.clearFirefoxCache());

        const succeeded = results.filter(r => r.success).length;
        return {
            success: succeeded > 0,
            message: `Cache cleared: ${succeeded}/${results.length} operations succeeded`,
            details: results,
        };
    }

    // ──────────────────────────────────────────────────────
    // NETWORK OPERATIONS
    // ──────────────────────────────────────────────────────

    async resetNetwork() {
        const script = `
            netsh winsock reset | Out-Null
            netsh int ip reset | Out-Null
            ipconfig /release | Out-Null
            ipconfig /flushdns | Out-Null
            ipconfig /renew | Out-Null
            Write-Output "Network stack reset complete. A restart may be required for Winsock reset."
        `;
        return ps(script);
    }

    async pingHost(host, count = 4) {
        return ps(`ping -n ${count} ${host}`);
    }

    async checkPort(host, port, timeout = 3000) {
        const script = `
            $tcp = New-Object System.Net.Sockets.TcpClient
            $connect = $tcp.BeginConnect("${host}", ${port}, $null, $null)
            $wait = $connect.AsyncWaitHandle.WaitOne(${timeout}, $false)
            if ($wait) {
                $tcp.EndConnect($connect)
                Write-Output "OPEN"
            } else {
                Write-Output "CLOSED"
            }
            $tcp.Close()
        `;
        const result = await ps(script);
        const open = result.output === 'OPEN';
        return { success: true, host, port, status: open ? 'open' : 'closed', message: `Port ${port} on ${host} is ${open ? 'OPEN' : 'CLOSED'}` };
    }

    async getPublicIp() {
        const script = `
            try {
                $ip = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing -TimeoutSec 5).Content.Trim()
                Write-Output $ip
            } catch {
                $ip = (Invoke-WebRequest -Uri "https://ifconfig.me/ip" -UseBasicParsing -TimeoutSec 5).Content.Trim()
                Write-Output $ip
            }
        `;
        const result = await ps(script);
        return { success: result.success, ip: result.output, message: `Public IP: ${result.output}` };
    }

    async getWifiNetworks() {
        const result = await shell('netsh wlan show networks mode=bssid');
        return { success: result.success, output: result.output, message: result.output };
    }

    async connectWifi(ssid, password) {
        const script = `
            $profile = @"
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
<name>${ssid}</name>
<SSIDConfig><SSID><name>${ssid}</name></SSID></SSIDConfig>
<connectionType>ESS</connectionType>
<connectionMode>auto</connectionMode>
<MSM><security>
<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption></authEncryption>
<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${password}</keyMaterial></sharedKey>
</security></MSM>
</WLANProfile>
"@
            $tmpFile = "$env:TEMP\\wifi_profile.xml"
            $profile | Out-File -FilePath $tmpFile -Encoding UTF8
            netsh wlan add profile filename="$tmpFile" | Out-Null
            netsh wlan connect name="${ssid}" | Out-Null
            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
            Write-Output "Connecting to ${ssid}..."
        `;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // WINDOWS SERVICES
    // ──────────────────────────────────────────────────────

    /**
     * @param {string} serviceName  e.g. "wuauserv", "Spooler", "BITS"
     * @param {string} action       "start"|"stop"|"restart"|"status"|"enable"|"disable"
     */
    async manageService(serviceName, action = 'status') {
        const act = action.toLowerCase();
        let script = '';

        switch (act) {
            case 'start':
                script = `Start-Service -Name "${serviceName}" -ErrorAction Stop; Write-Output "Service '${serviceName}' started successfully"`;
                break;
            case 'stop':
                script = `Stop-Service -Name "${serviceName}" -Force -ErrorAction Stop; Write-Output "Service '${serviceName}' stopped successfully"`;
                break;
            case 'restart':
                script = `Restart-Service -Name "${serviceName}" -Force -ErrorAction Stop; Write-Output "Service '${serviceName}' restarted successfully"`;
                break;
            case 'enable':
                script = `Set-Service -Name "${serviceName}" -StartupType Automatic; Start-Service "${serviceName}" -ErrorAction SilentlyContinue; Write-Output "Service '${serviceName}' enabled and set to automatic"`;
                break;
            case 'disable':
                script = `Stop-Service -Name "${serviceName}" -Force -ErrorAction SilentlyContinue; Set-Service -Name "${serviceName}" -StartupType Disabled; Write-Output "Service '${serviceName}' disabled"`;
                break;
            default:
                script = `
                    $svc = Get-Service -Name "${serviceName}" -ErrorAction SilentlyContinue
                    if ($svc) {
                        [PSCustomObject]@{
                            Name = $svc.Name; DisplayName = $svc.DisplayName
                            Status = $svc.Status.ToString(); StartType = $svc.StartType.ToString()
                        } | ConvertTo-Json
                    } else { Write-Output "Service not found: ${serviceName}" }
                `;
        }

        const result = await ps(script);
        if (act === 'status') {
            try {
                const data = JSON.parse(result.output);
                return { success: true, service: data, message: `${data.DisplayName}: ${data.Status}` };
            } catch {
                return { success: result.success, message: result.output || result.error };
            }
        }
        return { success: result.success, message: result.output || result.error };
    }

    async listServices(filter = 'all') {
        const where = filter === 'running' ? "Where-Object { $_.Status -eq 'Running' }" : 'Where-Object { $_ }';
        const script = `Get-Service | ${where} | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json -Compress`;
        const result = await ps(script);
        try {
            const services = JSON.parse(result.output);
            return { success: true, services: Array.isArray(services) ? services : [services] };
        } catch { return { success: false, error: result.error || result.output }; }
    }

    // ──────────────────────────────────────────────────────
    // PROCESS MANAGEMENT
    // ──────────────────────────────────────────────────────

    async getRunningProcesses(sortBy = 'cpu') {
        const sort = sortBy === 'mem' ? 'WorkingSet' : 'CPU';
        const script = `
            Get-Process | Sort-Object -Property ${sort} -Descending | Select-Object -First 30 |
            Select-Object Name, Id,
                @{N='CPU_s';E={[math]::Round($_.CPU,2)}},
                @{N='Mem_MB';E={[math]::Round($_.WorkingSet/1MB,1)}},
                MainWindowTitle |
            ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const procs = JSON.parse(result.output);
            return { success: true, processes: Array.isArray(procs) ? procs : [procs] };
        } catch { return { success: false, error: result.output }; }
    }

    async killProcess(nameOrPid) {
        const isNum = /^\d+$/.test(String(nameOrPid));
        const script = isNum
            ? `Stop-Process -Id ${nameOrPid} -Force; Write-Output "Process ${nameOrPid} killed"`
            : `Stop-Process -Name "${nameOrPid}" -Force -ErrorAction SilentlyContinue; Write-Output "Process '${nameOrPid}' killed"`;
        return ps(script);
    }

    async getProcessDetails(nameOrPid) {
        const isNum = /^\d+$/.test(String(nameOrPid));
        const filter = isNum ? `-Id ${nameOrPid}` : `-Name "${nameOrPid}"`;
        const script = `Get-Process ${filter} | Select-Object Name, Id, CPU, WorkingSet, Path, Company, Description | ConvertTo-Json`;
        const result = await ps(script);
        try { return { success: true, process: JSON.parse(result.output) }; }
        catch { return { success: false, error: result.output }; }
    }

    // ──────────────────────────────────────────────────────
    // STARTUP PROGRAMS
    // ──────────────────────────────────────────────────────

    async listStartupPrograms() {
        const script = `
            $items = @()
            $regPaths = @(
                "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run"
            )
            foreach ($reg in $regPaths) {
                if (Test-Path $reg) {
                    Get-ItemProperty $reg | Get-Member -MemberType NoteProperty |
                    Where-Object { $_.Name -notlike "PS*" } | ForEach-Object {
                        $items += [PSCustomObject]@{
                            Name = $_.Name
                            Path = (Get-ItemPropertyValue $reg $_.Name -ErrorAction SilentlyContinue)
                            Location = $reg
                        }
                    }
                }
            }
            $items | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const items = JSON.parse(result.output);
            return { success: true, programs: Array.isArray(items) ? items : [items] };
        } catch { return { success: false, error: result.output }; }
    }

    async toggleStartupProgram(name, enable) {
        if (!enable) {
            const script = `
                $paths = @("HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                           "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run")
                $found = $false
                foreach ($p in $paths) {
                    if ((Get-ItemProperty $p -ErrorAction SilentlyContinue)."${name}") {
                        $val = (Get-ItemPropertyValue $p "${name}")
                        New-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run_Disabled" -Name "${name}" -Value $val -Force -ErrorAction SilentlyContinue | Out-Null
                        Remove-ItemProperty -Path $p -Name "${name}" -ErrorAction SilentlyContinue
                        $found = $true
                        break
                    }
                }
                if ($found) { Write-Output "Startup entry '${name}' disabled" }
                else { Write-Output "Startup entry '${name}' not found" }
            `;
            return ps(script);
        } else {
            const script = `
                $disabledKey = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run_Disabled"
                if ((Get-ItemProperty $disabledKey -ErrorAction SilentlyContinue)."${name}") {
                    $val = Get-ItemPropertyValue $disabledKey "${name}"
                    Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${name}" -Value $val
                    Remove-ItemProperty -Path $disabledKey -Name "${name}" -ErrorAction SilentlyContinue
                    Write-Output "Startup entry '${name}' re-enabled"
                } else {
                    Write-Output "Startup entry '${name}' not found in disabled list"
                }
            `;
            return ps(script);
        }
    }

    // ──────────────────────────────────────────────────────
    // WINDOWS UPDATE
    // ──────────────────────────────────────────────────────

    async checkWindowsUpdate() {
        // Open Windows Update settings page
        const result = await shell('start ms-settings:windowsupdate-action');
        return { success: true, message: 'Opened Windows Update settings. Updates will be checked automatically.' };
    }

    async getWindowsUpdateHistory() {
        const script = `
            $session = New-Object -ComObject "Microsoft.Update.Session"
            $searcher = $session.CreateUpdateSearcher()
            $count = $searcher.GetTotalHistoryCount()
            $history = $searcher.QueryHistory(0, [Math]::Min($count, 20))
            $results = @()
            foreach ($item in $history) {
                $results += [PSCustomObject]@{
                    Date = $item.Date.ToString("yyyy-MM-dd")
                    Title = $item.Title
                    Result = switch($item.ResultCode) {
                        1 {"In Progress"} 2 {"Succeeded"} 3 {"Succeeded with Errors"} 4 {"Failed"} 5 {"Aborted"} default {"Unknown"}
                    }
                }
            }
            $results | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const history = JSON.parse(result.output);
            return { success: true, history: Array.isArray(history) ? history : [history] };
        } catch { return { success: false, error: result.output, message: 'Use Windows Update settings to check update history.' }; }
    }

    // ──────────────────────────────────────────────────────
    // EVENT LOGS
    // ──────────────────────────────────────────────────────

    /**
     * @param {string} logType  "System"|"Application"|"Security"
     * @param {number} count    How many recent entries
     * @param {string} level    "Error"|"Warning"|"Information"
     */
    async getEventLogs(logType = 'System', count = 20, level = '') {
        const levelFilter = level ? ` | Where-Object { $_.EntryType -eq "${level}" }` : '';
        const script = `
            Get-EventLog -LogName "${logType}" -Newest ${count}${levelFilter} |
            Select-Object TimeGenerated, EntryType, Source, EventID,
                @{N='Message';E={$_.Message.Substring(0,[Math]::Min(200,$_.Message.Length))}} |
            ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const logs = JSON.parse(result.output);
            return { success: true, logs: Array.isArray(logs) ? logs : [logs], count: (Array.isArray(logs) ? logs.length : 1) };
        } catch { return { success: false, error: result.output }; }
    }

    async clearEventLog(logType = 'Application') {
        const script = `Clear-EventLog -LogName "${logType}"; Write-Output "${logType} event log cleared"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // SYSTEM RESTORE
    // ──────────────────────────────────────────────────────

    async createRestorePoint(description = 'Pecifics Auto Restore Point') {
        const script = `
            Enable-ComputerRestore -Drive "C:\\" -ErrorAction SilentlyContinue
            Checkpoint-Computer -Description "${description}" -RestorePointType "MODIFY_SETTINGS" -ErrorAction Stop
            Write-Output "Restore point created: ${description}"
        `;
        return ps(script);
    }

    async listRestorePoints() {
        const script = `Get-ComputerRestorePoint | Select-Object SequenceNumber, Description, CreationTime | ConvertTo-Json -Compress`;
        const result = await ps(script);
        try {
            const points = JSON.parse(result.output);
            return { success: true, points: Array.isArray(points) ? points : [points] };
        } catch { return { success: false, error: result.output }; }
    }

    // ──────────────────────────────────────────────────────
    // INSTALLED APPLICATIONS
    // ──────────────────────────────────────────────────────

    async getInstalledApps() {
        const script = `
            $apps = @()
            $regPaths = @(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
            )
            foreach ($reg in $regPaths) {
                Get-ChildItem $reg -ErrorAction SilentlyContinue | ForEach-Object {
                    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                    if ($props.DisplayName -and $props.DisplayName.Trim() -ne "") {
                        $apps += [PSCustomObject]@{
                            Name = $props.DisplayName
                            Version = $props.DisplayVersion
                            Publisher = $props.Publisher
                            InstallDate = $props.InstallDate
                        }
                    }
                }
            }
            $apps | Sort-Object Name | Select-Object -Unique | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const apps = JSON.parse(result.output);
            return { success: true, apps: Array.isArray(apps) ? apps : [apps], count: (Array.isArray(apps) ? apps.length : 1) };
        } catch { return { success: false, error: result.output }; }
    }

    async uninstallApp(appName) {
        const script = `
            $found = $false
            $regPaths = @(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
            )
            foreach ($reg in $regPaths) {
                Get-ChildItem $reg -ErrorAction SilentlyContinue | ForEach-Object {
                    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                    if ($props.DisplayName -like "*${appName}*" -and $props.UninstallString -and -not $found) {
                        $found = $true
                        $uninstallCmd = $props.UninstallString
                        if ($uninstallCmd -match "MsiExec") {
                            $productCode = [regex]::Match($uninstallCmd, '{[A-F0-9-]+}').Value
                            Start-Process msiexec.exe -ArgumentList "/x $productCode /quiet /norestart" -Wait
                        } else {
                            Start-Process "cmd.exe" -ArgumentList "/c $uninstallCmd" -Wait
                        }
                        Write-Output "Uninstall initiated for: $($props.DisplayName)"
                    }
                }
            }
            if (-not $found) { Write-Output "App not found: ${appName}" }
        `;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // ENVIRONMENT VARIABLES
    // ──────────────────────────────────────────────────────

    async getEnvVariable(name) {
        const val = process.env[name];
        if (val !== undefined) return { success: true, name, value: val };
        const result = await ps(`[Environment]::GetEnvironmentVariable("${name}", "Machine")`);
        return { success: true, name, value: result.output || '', scope: 'Machine' };
    }

    async setEnvVariable(name, value, scope = 'User') {
        const script = `[Environment]::SetEnvironmentVariable("${name}", "${value}", "${scope}"); Write-Output "Set $env:${name}=${value} in ${scope} scope"`;
        return ps(script);
    }

    async deleteEnvVariable(name, scope = 'User') {
        const script = `[Environment]::SetEnvironmentVariable("${name}", $null, "${scope}"); Write-Output "Deleted env var ${name} from ${scope} scope"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // REGISTRY (safe user-scope operations)
    // ──────────────────────────────────────────────────────

    async readRegistry(keyPath, valueName) {
        const script = `
            try {
                $val = Get-ItemPropertyValue -Path "${keyPath}" -Name "${valueName}" -ErrorAction Stop
                Write-Output $val
            } catch {
                Write-Output "NOT_FOUND"
            }
        `;
        const result = await ps(script);
        return { success: result.output !== 'NOT_FOUND', value: result.output, key: keyPath, name: valueName };
    }

    async writeRegistry(keyPath, valueName, value, valueType = 'String') {
        // Only allow HKCU writes for safety
        if (!keyPath.startsWith('HKCU:') && !keyPath.startsWith('HKEY_CURRENT_USER')) {
            return { success: false, error: 'Safety: Only HKCU registry writes are allowed' };
        }
        const script = `
            if (-not (Test-Path "${keyPath}")) { New-Item -Path "${keyPath}" -Force | Out-Null }
            Set-ItemProperty -Path "${keyPath}" -Name "${valueName}" -Value "${value}" -Type ${valueType}
            Write-Output "Registry value set: ${keyPath}\\${valueName} = ${value}"
        `;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // DISK & STORAGE
    // ──────────────────────────────────────────────────────

    async getDiskHealth() {
        const script = `
            $disks = Get-PhysicalDisk | Select-Object FriendlyName, MediaType, Size, HealthStatus, OperationalStatus |
                ForEach-Object {
                    $_ | Add-Member -NotePropertyName 'Size_GB' -NotePropertyValue ([math]::Round($_.Size / 1GB, 2)) -PassThru
                }
            $disks | Select-Object FriendlyName, MediaType, Size_GB, HealthStatus, OperationalStatus | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const disks = JSON.parse(result.output);
            return { success: true, disks: Array.isArray(disks) ? disks : [disks] };
        } catch { return { success: false, error: result.output }; }
    }

    async analyzeStorageByFolder(path = 'C:\\Users') {
        const script = `
            Get-ChildItem "${path.replace(/\\/g,'\\\\')}" -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                $size = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                [PSCustomObject]@{ Folder = $_.Name; Size_MB = [math]::Round($size/1MB,1) }
            } | Sort-Object Size_MB -Descending | Select-Object -First 15 | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const items = JSON.parse(result.output);
            return { success: true, folders: Array.isArray(items) ? items : [items] };
        } catch { return { success: false, error: result.output }; }
    }

    async runDiskCleanupSilent() {
        // Run disk cleanup with pre-configured settings silently
        const script = `
            $vol = "C"
            $regPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches"
            $categories = @("Temporary Files","Recycle Bin","Temporary Internet Files",
                           "Downloaded Program Files","Thumbnails","Memory Dump Files",
                           "Old ChkDsk Files","Setup Log Files")
            foreach ($cat in $categories) {
                $path = "$regPath\\$cat"
                if (Test-Path $path) {
                    Set-ItemProperty -Path $path -Name "StateFlags0001" -Value 2 -Type DWord -ErrorAction SilentlyContinue
                }
            }
            Start-Process "cleanmgr.exe" -ArgumentList "/sagerun:1" -Wait -ErrorAction SilentlyContinue
            Write-Output "Disk Cleanup completed"
        `;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // POWER MANAGEMENT
    // ──────────────────────────────────────────────────────

    async getPowerPlan() {
        const result = await shell('powercfg /getactivescheme');
        return { success: result.success, output: result.output, message: result.output };
    }

    async setPowerPlan(plan = 'balanced') {
        const plans = {
            'balanced':   '381b4222-f694-41f0-9685-ff5bb260df2e',
            'performance': '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
            'saver':      'a1841308-3541-4fab-bc81-f71556f20b4a',
        };
        const guid = plans[plan.toLowerCase()] || plans['balanced'];
        const result = await shell(`powercfg /setactive ${guid}`);
        return { success: result.success, message: `Power plan set to: ${plan}` };
    }

    async hibernate() {
        return shell('shutdown /h');
    }

    async restart(delay = 0) {
        if (delay > 0) {
            return shell(`shutdown /r /t ${delay}`);
        }
        return shell('shutdown /r /t 0');
    }

    async shutdown(delay = 0) {
        if (delay > 0) {
            return shell(`shutdown /s /t ${delay}`);
        }
        return shell('shutdown /s /t 0');
    }

    async cancelShutdown() {
        return shell('shutdown /a');
    }

    // ──────────────────────────────────────────────────────
    // SECURITY / DEFENDER
    // ──────────────────────────────────────────────────────

    async quickScan() {
        const script = `Start-MpScan -ScanType QuickScan; Write-Output "Windows Defender Quick Scan started"`;
        return ps(script);
    }

    async getDefenderStatus() {
        const script = `Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated | ConvertTo-Json`;
        const result = await ps(script);
        try { return { success: true, status: JSON.parse(result.output) }; }
        catch { return { success: false, error: result.output }; }
    }

    async checkFirewallStatus() {
        const script = `Get-NetFirewallProfile | Select-Object Name, Enabled | ConvertTo-Json`;
        const result = await ps(script);
        try { return { success: true, profiles: JSON.parse(result.output) }; }
        catch { return { success: false, error: result.output }; }
    }

    // ──────────────────────────────────────────────────────
    // SCHEDULED TASKS
    // ──────────────────────────────────────────────────────

    async listScheduledTasks(path = '\\') {
        const script = `
            Get-ScheduledTask -TaskPath "${path}" -ErrorAction SilentlyContinue |
            Select-Object TaskName, TaskPath, State, Description |
            Select-Object -First 30 | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const tasks = JSON.parse(result.output);
            return { success: true, tasks: Array.isArray(tasks) ? tasks : [tasks] };
        } catch { return { success: false, error: result.output }; }
    }

    async runScheduledTask(taskName) {
        const script = `Start-ScheduledTask -TaskName "${taskName}"; Write-Output "Task '${taskName}' started"`;
        return ps(script);
    }

    async disableScheduledTask(taskName) {
        const script = `Disable-ScheduledTask -TaskName "${taskName}"; Write-Output "Task '${taskName}' disabled"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // FONTS
    // ──────────────────────────────────────────────────────

    async listInstalledFonts() {
        const script = `
            [System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null
            $fonts = New-Object System.Drawing.Text.InstalledFontCollection
            $fonts.Families | Select-Object Name | ConvertTo-Json -Compress
        `;
        const result = await ps(script);
        try {
            const fonts = JSON.parse(result.output);
            return { success: true, fonts: Array.isArray(fonts) ? fonts.map(f => f.Name) : [fonts.Name] };
        } catch { return { success: false, error: result.output }; }
    }

    // ──────────────────────────────────────────────────────
    // CLIPBOARD
    // ──────────────────────────────────────────────────────

    async getClipboard() {
        const script = `Add-Type -Assembly PresentationCore; [Windows.Clipboard]::GetText([Windows.TextDataFormat]::UnicodeText)`;
        const result = await ps(script);
        return { success: result.success, content: result.output };
    }

    async setClipboard(text) {
        const escaped = text.replace(/'/g, "''");
        const script = `Set-Clipboard -Value '${escaped}'; Write-Output "Clipboard updated"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // NOTIFICATIONS
    // ──────────────────────────────────────────────────────

    async showNotification(title, message, duration = 5) {
        const safeTitle = (title || 'Notification').replace(/'/g, '`\'').replace(/\r?\n/g, ' ');
        const safeMsg   = (message || '').replace(/'/g, '`\'').replace(/\r?\n/g, ' ');
        const dur = Math.max(1, Math.min(duration, 10));
        // Write to temp file — avoids all inline script quoting issues
        const tmpFile = require('path').join(require('os').tmpdir(), `pecifics_notify_${Date.now()}.ps1`);
        const script = `
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
    $nodes = $xml.GetElementsByTagName('text')
    $nodes[0].AppendChild($xml.CreateTextNode('${safeTitle}')) | Out-Null
    $nodes[1].AppendChild($xml.CreateTextNode('${safeMsg}')) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pecifics')
    $notifier.Show($toast)
    Write-Output 'Toast notification shown'
} catch {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Information
        $notify.Visible = $true
        $notify.ShowBalloonTip(${dur * 1000}, '${safeTitle}', '${safeMsg}', 1)
        Start-Sleep -Seconds ${Math.min(dur, 4)}
        $notify.Dispose()
        Write-Output 'Balloon notification shown'
    } catch {
        Write-Output "Notification: ${safeTitle}"
    }
}
`;
        const fs = require('fs');
        fs.writeFileSync(tmpFile, script, 'utf8');
        return new Promise((resolve) => {
            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
                { maxBuffer: 1024 * 1024, timeout: 15000 },
                (err, stdout, stderr) => {
                    try { fs.unlinkSync(tmpFile); } catch {}
                    const out = (stdout || '').trim();
                    resolve({ success: !err || !!out, message: out || 'Notification sent', output: out });
                }
            );
        });
    }

    // ──────────────────────────────────────────────────────
    // DISPLAY / THEMES
    // ──────────────────────────────────────────────────────

    async toggleDarkMode(enable) {
        const value = enable ? 0 : 1;
        const script = `
            Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "AppsUseLightTheme" -Value ${value} -Type DWord
            Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "SystemUsesLightTheme" -Value ${value} -Type DWord
            
            # Broadcast setting change so theme applies instantly
            $signature = @'
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
                [DllImport("user32.dll", EntryPoint="SendMessageTimeout", SetLastError=true, CharSet=CharSet.Auto)]
                public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
            }
'@
            Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
            $result = [IntPtr]::Zero
            [Win32]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [IntPtr]::Zero, "ImmersiveColorSet", 2, 5000, [ref]$result) | Out-Null
            
            Write-Output "Dark mode ${enable ? 'enabled' : 'disabled'}"
        `;
        return ps(script);
    }

    async setTaskbarPosition(position = 'bottom') {
        const posMap = { bottom: 0, left: 1, top: 2, right: 3 };
        const val = posMap[position.toLowerCase()] ?? 0;
        const script = `
            Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3" -Name "Settings" -Value ([byte[]](0x28,0x00,0x00,0x00,0xFF,0xFF,0xFF,0xFF,0x02,0x00,0x00,0x00,0x${val.toString(16).padStart(2,'0')},0x00,0x00,0x00)) -ErrorAction SilentlyContinue
            Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            Start-Process explorer
            Write-Output "Taskbar moved to ${position}"
        `;
        return ps(script);
    }

    async refreshDesktop() {
        const script = `
            Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            Start-Process explorer
            Write-Output "Desktop refreshed"
        `;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // WINDOWS FEATURES
    // ──────────────────────────────────────────────────────

    async listWindowsFeatures() {
        const script = `Get-WindowsOptionalFeature -Online | Where-Object { $_.State -eq "Enabled" } | Select-Object FeatureName | ConvertTo-Json -Compress`;
        const result = await ps(script);
        try { return { success: true, features: JSON.parse(result.output) }; }
        catch { return { success: false, error: result.output }; }
    }

    async enableWindowsFeature(featureName) {
        const script = `Enable-WindowsOptionalFeature -Online -FeatureName "${featureName}" -NoRestart; Write-Output "Feature '${featureName}' enabled"`;
        return ps(script);
    }

    async disableWindowsFeature(featureName) {
        const script = `Disable-WindowsOptionalFeature -Online -FeatureName "${featureName}" -NoRestart; Write-Output "Feature '${featureName}' disabled"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // TASKBAR & START MANIPULATION
    // ──────────────────────────────────────────────────────

    async openTaskManager() {
        return shell('start taskmgr.exe');
    }

    async openControlPanel() {
        return shell('start control.exe');
    }

    async openFileExplorer(path = '') {
        const target = path ? `"${path}"` : '';
        return shell(`start explorer.exe ${target}`);
    }

    async openCommandPromptAsAdmin() {
        const script = `Start-Process cmd.exe -Verb RunAs; Write-Output "Opened CMD as Administrator"`;
        return ps(script);
    }

    async openPowerShellAsAdmin() {
        const script = `Start-Process powershell.exe -Verb RunAs; Write-Output "Opened PowerShell as Administrator"`;
        return ps(script);
    }

    // ──────────────────────────────────────────────────────
    // SYSTEM HEALTH SUMMARY
    // ──────────────────────────────────────────────────────

    async getFullSystemHealth() {
        const [battery, disk, network, processes] = await Promise.all([
            ps(`$b = Get-CimInstance Win32_Battery; if ($b) { [PSCustomObject]@{level=$b.EstimatedChargeRemaining;charging=($b.BatteryStatus-eq 2)} | ConvertTo-Json } else { '{"level":-1}' }`),
            ps(`Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Used -ne $null} | ForEach-Object { [PSCustomObject]@{drive=$_.Name;free=[math]::Round($_.Free/1GB,1);total=[math]::Round(($_.Free+$_.Used)/1GB,1)} } | ConvertTo-Json -Compress`),
            ps(`$a = Get-NetAdapter | Where-Object {$_.Status -eq "Up"} | Select-Object -First 1; if($a){Write-Output "$($a.Name): $($a.Status)"}else{Write-Output "No active adapter"}`),
            ps(`$p = Get-Process | Measure-Object | Select-Object -Expand Count; Write-Output $p`),
        ]);

        let batt, drv;
        try { batt = JSON.parse(battery.output); } catch { batt = {}; }
        try { drv  = JSON.parse(disk.output);    } catch { drv  = []; }

        return {
            success: true,
            battery: batt,
            disks: Array.isArray(drv) ? drv : [drv],
            network: network.output,
            processCount: processes.output,
            timestamp: new Date().toISOString(),
        };
    }
}

module.exports = new OSTasks();
