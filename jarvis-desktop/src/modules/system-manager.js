const { exec, execFile, execSync, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const CHROME_DEBUG_PORT = Number(process.env.PECIFICS_CHROME_CDP_PORT || 9222);
const CHROME_PROFILE_DIRECTORY = process.env.PECIFICS_CHROME_PROFILE || 'Default';
const CHROME_USER_DATA = process.env.PECIFICS_CHROME_USER_DATA ||
    path.join(os.homedir(), 'AppData', 'Local', 'Pecifics', 'ChromeProfile');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class SystemManager {
    findChromePath() {
        const candidates = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ];
        return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
    }

    async isChromeDebugPortOpen(timeoutMs = 1500) {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`, (res) => {
                res.resume();
                resolve(res.statusCode >= 200 && res.statusCode < 300);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    isChromeRunning() {
        try {
            const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 5000,
            });
            return out.toLowerCase().includes('chrome.exe');
        } catch {
            return false;
        }
    }

    async launchChromeWithDebugPort(chromePath = null) {
        const chromeExe = chromePath || this.findChromePath();
        if (!chromeExe) throw new Error('Chrome not found on this machine.');
        fs.mkdirSync(CHROME_USER_DATA, { recursive: true });

        const args = [
            `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
            `--user-data-dir=${CHROME_USER_DATA}`,
            `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
            '--no-startup-window',
            '--no-first-run',
            '--no-default-browser-check',
        ];
        const child = spawn(chromeExe, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.unref();

        for (let i = 0; i < 12; i++) {
            await delay(750);
            if (await this.isChromeDebugPortOpen(800)) {
                return {
                    success: true,
                    status: 'launched',
                    port: CHROME_DEBUG_PORT,
                    profile: CHROME_PROFILE_DIRECTORY,
                    message: `Chrome launched with remote debugging on port ${CHROME_DEBUG_PORT}`,
                };
            }
        }
        throw new Error('Chrome launched but the debug port did not open in time.');
    }

    async ensureChromeWithDebugPort(options = {}) {
        if (await this.isChromeDebugPortOpen()) {
            return { success: true, status: 'already_ready', port: CHROME_DEBUG_PORT };
        }

        const chromePath = this.findChromePath();
        if (!chromePath) {
            return { success: false, status: 'chrome_not_found', error: 'Chrome not found on this machine.' };
        }

        if (this.isChromeRunning()) {
            if (options.autoRelaunch) {
                return await this.forceRelaunchChrome();
            }
            return {
                success: false,
                status: 'needs_relaunch',
                needsUserAction: true,
                userMessage: 'Chrome is open without remote debugging. Say "relaunch Chrome" to let Pecifics close and reopen Chrome with the debug bridge, then retry.',
            };
        }

        try {
            return await this.launchChromeWithDebugPort(chromePath);
        } catch (e) {
            return { success: false, status: 'launch_failed', error: e.message };
        }
    }

    async forceRelaunchChrome() {
        try {
            execSync('taskkill /F /IM chrome.exe /T', {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 10000,
            });
        } catch {
            // Chrome was already closed.
        }
        await delay(2000);
        return await this.launchChromeWithDebugPort(this.findChromePath());
    }

    /**
     * Clear temporary files from Windows temp folders
     * @param {boolean} includeCache - Also clear browser cache and system cache
     * @returns {Promise<Object>} Cleanup result with space freed
     */
    async clearTempFiles(includeCache = false) {
        return new Promise((resolve) => {
            const tempPath = process.env.TEMP || 'C:\\Windows\\Temp';
            const userTemp = process.env.TEMP;
            
            let psScript = `$before = (Get-PSDrive C).Used; Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue`;
            
            if (includeCache) {
                psScript += `; Remove-Item -Path "$env:LOCALAPPDATA\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache\\*" -Recurse -Force -ErrorAction SilentlyContinue`;
            }
            
            psScript += `; $after = (Get-PSDrive C).Used; $freed = [math]::Round(($before - $after) / 1MB, 2); @{success=$true; freedMB=$freed; message="Cleared temp files. Freed: " + $freed + " MB"} | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ success: true, message: 'Temp files cleared', freedMB: 0 });
                }
            });
        });
    }

    /**
     * Change desktop wallpaper
     * @param {string} imagePath - Full path to image file
     * @returns {Promise<Object>} Result
     */
    async setWallpaper(imagePath) {
        return new Promise((resolve) => {
            // Use registry + rundll32 to update wallpaper
            const psScript = `Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value '${imagePath}'; rundll32.exe user32.dll,UpdatePerUserSystemParameters ,1 ,True; @{success=$true; message='Wallpaper changed'} | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ success: !error, message: error ? error.message : 'Wallpaper changed' });
                }
            });
        });
    }

    /**
     * Toggle WiFi on/off
     * @param {boolean} enable - true to enable, false to disable
     * @returns {Promise<Object>} Result
     */
    async toggleWiFi(enable) {
        return new Promise((resolve) => {
            const action = enable ? 'enable' : 'disable';
            const psScript = `
try {
    $adapters = Get-NetAdapter | Where-Object { $_.Name -like '*Wi-Fi*' -or $_.Name -like '*Wireless*' }
    if ($adapters) {
        foreach ($adapter in $adapters) {
            ${enable ? 'Enable-NetAdapter' : 'Disable-NetAdapter'} -Name $adapter.Name -Confirm:$false -ErrorAction Stop
        }
        @{success=$true; message="WiFi ${action}d"} | ConvertTo-Json
    } else {
        @{success=$false; message="No WiFi adapter found"} | ConvertTo-Json
    }
} catch {
    if ($_.Exception.Message -like '*administrator*' -or $_.Exception.Message -like '*permission*' -or $_.CategoryInfo.Category -eq 'PermissionDenied') {
        @{success=$false; error="NEED_ADMIN"; message="⚠️ Administrator privileges required to toggle Wi-Fi. Please right-click the Pecifics shortcut -> Run as administrator."} | ConvertTo-Json
    } else {
        @{success=$false; error="ERROR"; message="Failed to toggle WiFi: " + $_.Exception.Message} | ConvertTo-Json
    }
}
`.replace(/\n/g, ' ');

            exec(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                } catch (e) {
                    if (error?.message.includes('administrator') || error?.message.includes('permission')) {
                        resolve({ success: false, message: '⚠️ Administrator privileges required to toggle Wi-Fi. Please right-click the Pecifics shortcut -> Run as administrator.' });
                    } else {
                        resolve({ success: !error, message: `WiFi ${action}d` });
                    }
                }
            });
        });
    }

    /**
     * Toggle Bluetooth on/off
     * @param {boolean} enable - true to enable, false to disable
     * @returns {Promise<Object>} Result
     * @note REQUIRES: VS Code/Node must be running as Administrator
     */
    async toggleBluetooth(enable) {
        return new Promise((resolve) => {
            const action = enable ? 'Enable' : 'Disable';
            
            // Get the main Bluetooth adapter and toggle it
            const psScript = `
try {
    $adapter = Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -like '*Bluetooth Adapter*' -or $_.FriendlyName -like '*Bluetooth*' } | Where-Object { $_.Status -ne 'Unknown' } | Select-Object -First 1
    if ($adapter) {
        ${action}-PnpDevice -InstanceId $adapter.InstanceId -Confirm:$false -ErrorAction Stop
        Write-Output "SUCCESS"
    } else {
        Write-Output "NO_ADAPTER"
    }
} catch {
    if ($_.Exception.Message -like '*administrator*') {
        Write-Output "NEED_ADMIN"
    } else {
        Write-Output "ERROR:$($_.Exception.Message)"
    }
}
`.replace(/\n/g, ' ');

            exec(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`, {timeout: 8000}, (error, stdout) => {
                const output = stdout.trim();
                
                if (output === 'SUCCESS') {
                    // Verify the change
                    setTimeout(() => {
                        const checkCmd = `powershell -Command "(Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -like '*Bluetooth Adapter*' } | Select-Object -First 1).Status"`;
                        exec(checkCmd, (err, checkOut) => {
                            const status = checkOut.trim();
                            const isEnabled = status === 'OK';
                            const isDisabled = status === 'Error';
                            
                            if ((enable && isEnabled) || (!enable && isDisabled)) {
                                resolve({ 
                                    success: true, 
                                    message: `Bluetooth ${enable ? 'enabled' : 'disabled'} successfully` 
                                });
                            } else {
                                resolve({ 
                                    success: false, 
                                    message: `Bluetooth command executed but state didn't change. Current status: ${status}` 
                                });
                            }
                        });
                    }, 1500);
                } else if (output === 'NEED_ADMIN' || error?.message.includes('administrator')) {
                    resolve({ 
                        success: false, 
                        message: '⚠️ Administrator rights required. Close VS Code and run as Administrator (Right-click → Run as administrator)' 
                    });
                } else if (output === 'NO_ADAPTER') {
                    resolve({ 
                        success: false, 
                        message: 'No Bluetooth adapter found on this system' 
                    });
                } else {
                    resolve({ 
                        success: false, 
                        message: `Failed: ${output || error?.message || 'Unknown error'}` 
                    });
                }
            });
        });
    }

    /**
     * Change display brightness
     * @param {number} brightness - Brightness level 0-100
     * @returns {Promise<Object>} Result
     */
    async setBrightness(brightness) {
        return new Promise((resolve) => {
            const level = Math.max(0, Math.min(100, brightness));
            const psScript = `
try {
    Invoke-CimMethod -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -MethodName WmiSetBrightness -Arguments @{Timeout = 1; Brightness = ${level}} -ErrorAction Stop
    @{success=$true; brightness=${level}; message="Brightness set to ${level}%"} | ConvertTo-Json
} catch {
    @{success=$false; error="DESKTOP_OR_UNSUPPORTED"; message="Brightness control is only supported on laptops with built-in displays. WMI class not found."} | ConvertTo-Json
}
`.replace(/\n/g, ' ');

            exec(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                } catch (e) {
                    resolve({ success: false, message: 'Brightness control is only supported on laptops with built-in displays.' });
                }
            });
        });
    }

    /**
     * Get current battery status
     * @returns {Promise<Object>} Battery info
     */
    async getBatteryStatus() {
        return new Promise((resolve) => {
            const psScript = `$battery = Get-CimInstance Win32_Battery; if ($battery) { @{hasBattery=$true; percentage=$battery.EstimatedChargeRemaining; status=$battery.BatteryStatus; isCharging=($battery.BatteryStatus -eq 2); message="Battery: " + $battery.EstimatedChargeRemaining + "%"} | ConvertTo-Json } else { @{hasBattery=$false; message="No battery detected (desktop computer)"} | ConvertTo-Json }`;

            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ hasBattery: false, message: 'Battery status unavailable' });
                }
            });
        });
    }

    /**
     * Change screen resolution
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     * @returns {Promise<Object>} Result
     */
    async setResolution(width, height) {
        return new Promise((resolve) => {
            const psScript = `Add-Type -TypeDefinition @" using System; using System.Runtime.InteropServices; public class Display { [DllImport(\\"user32.dll\\")] public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags); [StructLayout(LayoutKind.Sequential)] public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight; } } "@; $devMode = New-Object Display+DEVMODE; $devMode.dmSize = [Runtime.InteropServices.Marshal]::SizeOf($devMode); $devMode.dmPelsWidth = ${width}; $devMode.dmPelsHeight = ${height}; $devMode.dmFields = 0x180000; $result = [Display]::ChangeDisplaySettings([ref]$devMode, 0); @{success=($result -eq 0); width=${width}; height=${height}; message="Resolution changed to ${width}x${height}"} | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ success: false, message: 'Failed to change resolution' });
                }
            });
        });
    }

    /**
     * Get system information
     * @returns {Promise<Object>} System info
     */
    async getSystemInfo() {
        return new Promise((resolve) => {
            const psScript = `
                $os = Get-CimInstance Win32_OperatingSystem
                $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
                $mem = Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum
                $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
                $battery = Get-CimInstance Win32_Battery | Select-Object -First 1

                $totalRAM_GB = [math]::Round($mem.Sum / 1GB, 1)
                if ($totalRAM_GB -eq 0) { $totalRAM_GB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) }
                $freeRAM_GB  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
                $usedRAM_GB  = [math]::Round($totalRAM_GB - $freeRAM_GB, 1)
                $ram_percent = [math]::Round(($usedRAM_GB / $totalRAM_GB) * 100, 1)

                $cpu_cores = [System.Environment]::ProcessorCount
                $cpu_load = if ($cpu.LoadPercentage -ne $null) { $cpu.LoadPercentage } else { 0 }

                $diskTotal_GB = [math]::Round($disk.Size / 1GB, 1)
                $diskFree_GB  = [math]::Round($disk.FreeSpace / 1GB, 1)
                $diskUsed_GB  = [math]::Round($diskTotal_GB - $diskFree_GB, 1)

                $battery_percent = $null
                $battery_charging = $false
                if ($battery) {
                    $battery_percent = $battery.EstimatedChargeRemaining
                    $battery_charging = ($battery.BatteryStatus -eq 2)
                }

                [PSCustomObject]@{
                  cpu_percent = $cpu_load
                  cpu_cores = $cpu_cores
                  ram_used_gb = $usedRAM_GB
                  ram_total_gb = $totalRAM_GB
                  ram_percent = $ram_percent
                  battery_percent = $battery_percent
                  battery_charging = $battery_charging
                  disk_used_gb = $diskUsed_GB
                  disk_total_gb = $diskTotal_GB
                } | ConvertTo-Json -Compress
            `.replace(/\s+/g, ' ').trim();

            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    const osType = os.type();
                    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
                    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
                    resolve({
                        cpu_percent: 0,
                        cpu_cores: os.cpus().length,
                        ram_used_gb: Math.round((totalMem - freeMem) * 10) / 10,
                        ram_total_gb: totalMem,
                        ram_percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
                        disk_used_gb: 0,
                        disk_total_gb: 0
                    });
                }
            });
        });
    }

    /**
     * Toggle Night Light mode
     * @param {boolean} enable - true to enable, false to disable
     * @returns {Promise<Object>} Result
     * Uses registry binary blob approach that works on Win10/11
     */
    async toggleNightLight(enable) {
        return new Promise((resolve) => {
            // Win10/11: Night Light state is stored as a binary blob in CloudStore.
            // The most reliable way is to use the Settings URI + SendKeys, OR
            // toggle via the quick-settings panel programmatically.
            // We use a hybrid: try registry first, fall back to ms-settings URI.
            const psScript = `
try {
    $regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default' + [char]0x24 + 'windows.data.bluelightreduction.bluelightreductionstate\\windows.data.bluelightreduction.bluelightreductionstate'
    if (Test-Path $regPath) {
        $data = (Get-ItemProperty -Path $regPath -Name Data -ErrorAction SilentlyContinue).Data
        if ($data -and $data.Length -gt 18) {
            # Byte 18 controls on/off: 0x15 = off → on, 0x13 = on → off
            if (${enable ? '$true' : '$false'}) {
                $data[18] = 0x15
            } else {
                $data[18] = 0x13
            }
            Set-ItemProperty -Path $regPath -Name Data -Value ([byte[]]$data) -Type Binary
            Write-Output 'REGISTRY_OK'
        } else {
            Write-Output 'FALLBACK'
        }
    } else {
        Write-Output 'FALLBACK'
    }
} catch {
    Write-Output 'FALLBACK'
}
`.replace(/\n/g, ' ');

            exec(`powershell -ExecutionPolicy Bypass -Command "${psScript}"`, { timeout: 5000 }, (error, stdout) => {
                const output = (stdout || '').trim();
                if (output === 'REGISTRY_OK') {
                    resolve({ success: true, enabled: enable, message: `Night Light ${enable ? 'enabled' : 'disabled'}` });
                } else {
                    // Fallback: open Night Light settings page
                    exec('start ms-settings:nightlight', () => {
                        resolve({ 
                            success: true, 
                            enabled: enable, 
                            message: `Night Light settings opened. Please toggle manually — registry approach unavailable.` 
                        });
                    });
                }
            });
        });
    }

    /**
     * Empty Recycle Bin
     * @returns {Promise<Object>} Result
     */
    async emptyRecycleBin() {
        return new Promise((resolve) => {
            const psScript = `Clear-RecycleBin -Force -ErrorAction SilentlyContinue; @{success=$true; message="Recycle Bin emptied"} | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ success: true, message: 'Recycle Bin emptied' });
                }
            });
        });
    }

    /**
     * Get disk space for all drives
     * @returns {Promise<Object>} Disk space info
     */
    async getDiskSpace() {
        return new Promise((resolve) => {
            // Use simpler PowerShell approach to avoid escaping issues
            const psScript = `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object { [PSCustomObject]@{ Drive = $_.Name; TotalGB = [math]::Round(($_.Used + $_.Free)/1GB, 2); UsedGB = [math]::Round($_.Used/1GB, 2); FreeGB = [math]::Round($_.Free/1GB, 2); PercentUsed = [math]::Round(($_.Used/($_.Used + $_.Free))*100, 1) } } | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, (error, stdout, stderr) => {
                if (error) {
                    return resolve({ success: false, drives: [], message: 'Failed to get disk space', error: stderr });
                }
                try {
                    let drives = JSON.parse(stdout.trim());
                    // Ensure drives is an array
                    if (!Array.isArray(drives)) {
                        drives = [drives];
                    }
                    resolve({
                        success: true,
                        drives: drives.map(d => ({
                            drive: d.Drive,
                            total_GB: d.TotalGB,
                            used_GB: d.UsedGB,
                            free_GB: d.FreeGB,
                            percent_used: d.PercentUsed
                        })),
                        message: `Retrieved disk space for ${drives.length} drive(s)`
                    });
                } catch (e) {
                    resolve({ success: false, drives: [], message: 'Failed to parse disk space data' });
                }
            });
        });
    }

    /**
     * Set system volume
     * @param {number} volume - Volume level 0-100
     * @returns {Promise<Object>} Result
     */
    async setVolume(volume) {
        return new Promise((resolve) => {
            const level = Math.max(0, Math.min(100, volume));
            const normalized = (level / 100).toFixed(4);
            
            // Primary: inline COM-based volume control (instant, silent)
            const inlineScript = `
try {
    Add-Type -TypeDefinition @"
    using System; using System.Runtime.InteropServices;
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int _A(); int _B(); int _C(); int _D();
        int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator { int _A(int a,int b, out IntPtr c); [return:MarshalAs(UnmanagedType.IUnknown)] object GetDefaultAudioEndpoint(int a, int b); }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevEnum {}
    public class VolSet {
        public static void Set(float v) {
            var e = (IMMDeviceEnumerator) new MMDevEnum();
            var dev = (IMMDevice) e.GetDefaultAudioEndpoint(0, 1);
            var iid = typeof(IAudioEndpointVolume).GUID;
            object vol; dev.Activate(ref iid, 23, System.IntPtr.Zero, out vol);
            ((IAudioEndpointVolume)vol).SetMasterVolumeLevelScalar(v, System.Guid.Empty);
        }
    }
"@
    [VolSet]::Set(${normalized})
    Write-Output "SUCCESS"
} catch {
    Write-Output "COM_FAILED"
}
`.replace(/\n/g, ' ');

            exec(`powershell -NoProfile -Command "${inlineScript.replace(/"/g, '\\"')}"`, {timeout: 5000}, (error, stdout) => {
                if (stdout && stdout.trim() === 'SUCCESS') {
                    resolve({ 
                        success: true, 
                        volume: level, 
                        message: `Volume set to ${level}%` 
                    });
                } else {
                    // Fallback: external ps1 script with SendKeys
                    const scriptPath = require('path').join(__dirname, 'set-volume.ps1');
                    exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Level ${level}`, {timeout: 8000}, (err2, stdout2) => {
                        if (stdout2 && stdout2.includes('SUCCESS')) {
                            resolve({ 
                                success: true, 
                                volume: level, 
                                message: `Volume set to ${level}% (fallback)` 
                            });
                        } else {
                            resolve({ 
                                success: false, 
                                volume: level, 
                                message: `Volume control failed: ${err2?.message || stdout2 || 'Unknown error'}` 
                            });
                        }
                    });
                }
            });
        });
    }

    /**
     * Lock the computer
     * @returns {Promise<Object>} Result
     */
    async lockComputer() {
        return new Promise((resolve) => {
            exec('rundll32.exe user32.dll,LockWorkStation', (error) => {
                resolve({ success: !error, message: 'Computer locked' });
            });
        });
    }

    /**
     * Put computer to sleep
     * @returns {Promise<Object>} Result
     */
    async sleep() {
        return new Promise((resolve) => {
            exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (error) => {
                resolve({ success: !error, message: 'Computer going to sleep' });
            });
        });
    }

    /**
     * Get network status
     * @returns {Promise<Object>} Network info
     */
    async getNetworkStatus() {
        return new Promise((resolve) => {
            const psScript = `Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $adapter = $_; $ip = (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress; [PSCustomObject]@{ Name = $adapter.Name; Type = $adapter.InterfaceDescription; Status = $adapter.Status; Speed = $adapter.LinkSpeed; IPAddress = $ip } } | ConvertTo-Json`;

            exec(`powershell -Command "${psScript}"`, (error, stdout, stderr) => {
                if (error) {
                    return resolve({ success: false, adapters: [], message: 'Failed to get network status' });
                }
                try {
                    let adapters = JSON.parse(stdout.trim());
                    if (!Array.isArray(adapters)) {
                        adapters = adapters ? [adapters] : [];
                    }
                    resolve({
                        success: true,
                        adapters: adapters.map(a => ({
                            name: a.Name,
                            type: a.Type,
                            status: a.Status,
                            speed: a.Speed,
                            ipAddress: a.IPAddress || 'N/A'
                        })),
                        message: `Found ${adapters.length} active network adapter(s)`
                    });
                } catch (e) {
                    resolve({ success: false, adapters: [], message: 'Failed to parse network data' });
                }
            });
        });
    }


    /**
     * Run Disk Cleanup utility
     * @returns {Promise<Object>} Result
     */
    async runDiskCleanup() {
        return new Promise((resolve) => {
            exec('cleanmgr /sagerun:1', (error) => {
                resolve({ success: !error, message: 'Disk Cleanup started' });
            });
        });
    }

    /**
     * Disable/Enable Windows Defender (requires admin)
     */
    async toggleWindowsDefender(enable) {
        return new Promise((resolve) => {
            const psScript = `Set-MpPreference -DisableRealtimeMonitoring ${enable ? '$false' : '$true'}; @{success=$true; enabled=${enable}; message="Windows Defender ${enable ? 'enabled' : 'disabled'}"} | ConvertTo-Json`;
            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try { resolve(JSON.parse(stdout)); }
                catch (e) { resolve({ success: false, message: 'Requires administrator privileges' }); }
            });
        });
    }

    /**
     * Toggle dark/light mode
     */
    async toggleDarkMode(enable) {
        return new Promise((resolve) => {
            const value = enable ? 0 : 1;
            const psScript = `
                Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "AppsUseLightTheme" -Value ${value} -Type DWord -ErrorAction SilentlyContinue
                Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "SystemUsesLightTheme" -Value ${value} -Type DWord -ErrorAction SilentlyContinue
                @{success=$true; enabled=${enable}; message="Dark mode ${enable ? 'enabled' : 'disabled'}"} | ConvertTo-Json
            `.replace(/\n/g, ' ');
            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                try { resolve(JSON.parse(stdout)); }
                catch (e) { resolve({ success: true, message: `Dark mode ${enable ? 'enabled' : 'disabled'}` }); }
            });
        });
    }

    /**
     * Focus an application window by name
     */
    async focusApp(appName) {
        return new Promise((resolve) => {
            const psScript = `
                Add-Type -TypeDefinition @"
                using System; using System.Runtime.InteropServices;
                public class WHelper {
                    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
                    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
                }
"@
                $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${appName}*" -and $_.MainWindowTitle -ne "" } | Select-Object -First 1
                if ($proc) {
                    [WHelper]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
                    [WHelper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
                    Write-Output "Focused: $($proc.MainWindowTitle)"
                } else {
                    Write-Output "Window not found for: ${appName}"
                }
            `.replace(/\n/g, ' ');
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
                resolve({ success: !error, message: (stdout || '').trim() || `Focus attempted for ${appName}` });
            });
        });
    }

    /**
     * Show desktop (Win+D)
     */
    async showDesktop() {
        return new Promise((resolve) => {
            const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^({ESC})"); Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait("d")`;
            exec(`powershell -NoProfile -Command "${psScript}"`, () => {
                resolve({ success: true, message: 'Showed desktop' });
            });
        });
    }

    /**
     * Take a screenshot and save it
     */
    async captureScreen(savePath = '') {
        const outPath = savePath || require('path').join(require('os').homedir(), 'Desktop', `screenshot_${Date.now()}.png`);
        return new Promise((resolve) => {
            const psScript = `
                Add-Type -AssemblyName System.Windows.Forms, System.Drawing
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
                $bmp.Save("${outPath.replace(/\\/g, '\\\\')}")
                $g.Dispose(); $bmp.Dispose()
                Write-Output "Screenshot saved: ${outPath.replace(/\\/g, '\\\\')}"
            `.replace(/\n/g, ' ');
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
                resolve({ success: !error, path: outPath, message: (stdout || '').trim() });
            });
        });
    }

    /**
     * Adjust screen scale/DPI
     */
    async setScaleFactor(percent = 100) {
        return new Promise((resolve) => {
            const val = Math.round(percent * 96 / 100); // convert % to DPI
            const psScript = `Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name LogPixels -Value ${val} -Type DWord; Write-Output "Scale set"`;
            exec(`powershell -Command "${psScript}"`, (error, stdout) => {
                resolve({ success: !error, message: `Display scale set to ${percent}%` });
            });
        });
    }

    /**
     * Open Settings to a specific page
     */
    async openSettings(page = '') {
        const pageMap = {
            'display':   'ms-settings:display',
            'sound':     'ms-settings:sound',
            'wifi':      'ms-settings:network-wifi',
            'bluetooth': 'ms-settings:bluetooth',
            'update':    'ms-settings:windowsupdate',
            'apps':      'ms-settings:appsfeatures',
            'privacy':   'ms-settings:privacy',
            'accounts':  'ms-settings:accounts',
            'time':      'ms-settings:dateandtime',
            'language':  'ms-settings:regionlanguage',
            'storage':   'ms-settings:storagesense',
            'battery':   'ms-settings:batterysaver',
            'power':     'ms-settings:powersleep',
            'default':   'ms-settings:',
        };
        const uri = pageMap[page.toLowerCase()] || pageMap['default'];
        return new Promise((resolve) => {
            exec(`start ${uri}`, () => {
                resolve({ success: true, message: `Opened Settings: ${page || 'home'}` });
            });
        });
    }

    /**
     * Get clipboard content
     */
    async getClipboard() {
        return new Promise((resolve) => {
            const psScript = `Add-Type -Assembly PresentationCore; [Windows.Clipboard]::GetText([Windows.TextDataFormat]::UnicodeText)`;
            exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
                resolve({ success: !error, content: (stdout || '').trim() });
            });
        });
    }

    /**
     * Set clipboard content
     */
    async setClipboard(text) {
        return new Promise((resolve) => {
            const escaped = text.replace(/'/g, "''");
            const psScript = `Set-Clipboard -Value '${escaped}'`;
            exec(`powershell -NoProfile -Command "${psScript}"`, (error) => {
                resolve({ success: !error, message: 'Clipboard updated' });
            });
        });
    }

    /**
     * Show Windows Toast notification
     */
    async showNotification(title, message) {
        return new Promise((resolve) => {
            const psScript = `
                Add-Type -AssemblyName System.Windows.Forms
                $n = New-Object System.Windows.Forms.NotifyIcon
                $n.Icon = [System.Drawing.SystemIcons]::Information
                $n.Visible = $true
                $n.ShowBalloonTip(5000, "${title}", "${message}", [System.Windows.Forms.ToolTipIcon]::Info)
                Start-Sleep -Seconds 2
                $n.Dispose()
            `.replace(/\n/g, ' ');
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error) => {
                resolve({ success: true, message: `Notification shown: ${title}` });
            });
        });
    }

    /**
     * List open windows
     */
    async listOpenWindows() {
        return new Promise((resolve) => {
            const psScript = `Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json -Compress`;
            exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
                try {
                    const windows = JSON.parse(stdout);
                    resolve({ success: true, windows: Array.isArray(windows) ? windows : [windows] });
                } catch (e) {
                    resolve({ success: false, error: 'Could not list windows' });
                }
            });
        });
    }

    /**
     * Mute / unmute system audio
     */
    async muteAudio(mute = true) {
        return new Promise((resolve) => {
            const psScript = `
                Add-Type -TypeDefinition @"
                using System.Runtime.InteropServices;
                [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                interface IAudioEndpointVolume {
                    int _A(); int _B(); int _C(); int _D();
                    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
                    int _F(); int GetMasterVolumeLevelScalar(out float pfLevel);
                    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
                    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
                }
                [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
                [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                interface IMMDeviceEnumerator { int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices); [return:MarshalAs(UnmanagedType.IUnknown)] object GetDefaultAudioEndpoint(int dataFlow, int role); }
                [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorClass {}
                public class AudioHelper {
                    public static void SetMute(bool mute) {
                        var e = (IMMDeviceEnumerator) new MMDeviceEnumeratorClass();
                        var dev = (IMMDevice) e.GetDefaultAudioEndpoint(0, 1);
                        var iid = typeof(IAudioEndpointVolume).GUID;
                        object vol; dev.Activate(ref iid, 23, IntPtr.Zero, out vol);
                        ((IAudioEndpointVolume)vol).SetMute(mute, System.Guid.Empty);
                    }
                }
"@
                [AudioHelper]::SetMute($${mute})
                Write-Output "${mute ? 'Audio muted' : 'Audio unmuted'}"
            `.replace(/\n/g, ' ');
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
                // Fallback for when COM approach fails
                if (error) {
                    const key = mute ? '174' : '175'; // Volume mute/unmute keys
                    const psSimple = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{${mute ? 'VOLUME_MUTE' : 'VOLUME_MUTE'}}"); Write-Output "toggled"`;
                    exec(`powershell -NoProfile -Command "${psSimple}"`, () => {});
                }
                resolve({ success: true, message: mute ? 'Audio muted' : 'Audio unmuted' });
            });
        });
    }

    /**
     * Get current volume level
     */
    async getVolume() {
        return new Promise((resolve) => {
            const psScript = `
                try {
                    Add-Type -TypeDefinition @"
                    using System.Runtime.InteropServices;
                    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                    interface IAudioEndpointVolume {
                        int _A();int _B();int _C();int _D();int _E();int _F();
                        int GetMasterVolumeLevelScalar(out float pfLevel);
                    }
                    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                    interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
                    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
                    interface IMMDeviceEnumerator { int _A(int a,int b, out IntPtr c); [return:MarshalAs(UnmanagedType.IUnknown)] object GetDefaultAudioEndpoint(int a, int b); }
                    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevEnum {}
                    public class VolumeHelper {
                        public static float GetVolume() {
                            var e = (IMMDeviceEnumerator) new MMDevEnum();
                            var dev = (IMMDevice) e.GetDefaultAudioEndpoint(0, 1);
                            var iid = typeof(IAudioEndpointVolume).GUID;
                            object vol; dev.Activate(ref iid, 23, System.IntPtr.Zero, out vol);
                            float v; ((IAudioEndpointVolume)vol).GetMasterVolumeLevelScalar(out v);
                            return v;
                        }
                    }
"@
                    $vol = [VolumeHelper]::GetVolume()
                    Write-Output ([math]::Round($vol * 100))
                } catch {
                    Write-Output "unknown"
                }
            `.replace(/\n/g, ' ');
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout) => {
                const vol = parseInt(stdout) || -1;
                resolve({ success: vol >= 0, volume: vol, message: vol >= 0 ? `Current volume: ${vol}%` : 'Volume unknown' });
            });
        });
    }

    /**
     * Get active visible UI elements in the foreground window using UI Automation
     * @returns {Promise<Object>} Elements list with coordinates
     */
    async getVisibleUIElements() {
        return new Promise((resolve) => {
            const psScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
try {
    $hwnd = [Win32]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { Write-Output '{"success":false,"error":"NO_ACTIVE_WINDOW"}'; exit }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($window -eq $null) { Write-Output '{"success":false,"error":"WINDOW_NOT_FOUND"}'; exit }
    $condition = [System.Windows.Automation.Condition]::TrueCondition
    $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $results = @()
    foreach ($el in $elements) {
        try {
            $name = $el.Current.Name
            $ctrlType = $el.Current.ControlType
            $rect = $el.Current.BoundingRectangle
            if (($ctrlType -eq [System.Windows.Automation.ControlType]::Button -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::Edit -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::Hyperlink -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::CheckBox -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::ComboBox -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::MenuItem -or
                 $ctrlType -eq [System.Windows.Automation.ControlType]::ListItem) -and
                $rect.Width -gt 0 -and $rect.Height -gt 0) {
                $results += @{
                    name = $name
                    type = $ctrlType.ProgrammaticName.Replace("ControlType.", "")
                    left = [math]::Round($rect.Left)
                    top = [math]::Round($rect.Top)
                    width = [math]::Round($rect.Width)
                    height = [math]::Round($rect.Height)
                }
            }
        } catch {}
    }
    @{success=$true; count=$results.Count; elements=$results} | ConvertTo-Json -Depth 5 -Compress
} catch {
    @{success=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress
}
`.replace(/\n/g, ' ');

            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { maxBuffer: 5 * 1024 * 1024, timeout: 15000 }, (error, stdout) => {
                if (error) {
                    return resolve({ success: false, error: error.message });
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                } catch (e) {
                    resolve({ success: false, error: 'Failed to parse UIA elements output' });
                }
            });
        });
    }
}

module.exports = new SystemManager();

