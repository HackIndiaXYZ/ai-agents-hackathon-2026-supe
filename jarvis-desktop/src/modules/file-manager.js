// ============================================
// JARVIS File Manager Module
// Advanced file and application management
// ============================================

const { exec, execFile, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class FileManager {
    constructor() {
        // Common search locations for files
        this.searchPaths = [
            os.homedir(),
            path.join(os.homedir(), 'Desktop'),
            path.join(os.homedir(), 'Documents'),
            path.join(os.homedir(), 'Downloads'),
            path.join(os.homedir(), 'Pictures'),
            path.join(os.homedir(), 'Videos'),
            path.join(os.homedir(), 'Music'),
            'C:\\',
            'D:\\',
            'E:\\'
        ];

        // Common application install locations
        this.appSearchPaths = [
            'C:\\Program Files',
            'C:\\Program Files (x86)',
            path.join(os.homedir(), 'AppData\\Local'),
            path.join(os.homedir(), 'AppData\\Roaming')
        ];
    }

    // ============================================
    // File Search Operations
    // ============================================

    resolveFriendlyLocation(location) {
        const raw = String(location || '').trim();
        const home = os.homedir();
        const oneDriveDesktop = path.join(home, 'OneDrive', 'Desktop');
        const normalDesktop = path.join(home, 'Desktop');
        if (!raw) return home;
        if (/^(desktop|on desktop|the desktop)$/i.test(raw)) {
            try {
                require('fs').accessSync(oneDriveDesktop);
                return oneDriveDesktop;
            } catch {
                return normalDesktop;
            }
        }
        if (/^documents$/i.test(raw)) return path.join(home, 'Documents');
        if (/^downloads$/i.test(raw)) return path.join(home, 'Downloads');
        if (/^pictures$/i.test(raw)) {
            const oneDrivePictures = path.join(home, 'OneDrive', 'Pictures');
            try {
                require('fs').accessSync(oneDrivePictures);
                return oneDrivePictures;
            } catch {
                return path.join(home, 'Pictures');
            }
        }
        if (raw.toLowerCase() === normalDesktop.toLowerCase()) {
            try {
                require('fs').accessSync(oneDriveDesktop);
                return oneDriveDesktop;
            } catch {}
        }
        return raw;
    }

    /**
     * Search for files by name pattern across common locations
     * @param {string} pattern - File name pattern to search for (supports wildcards)
     * @param {string} location - Optional: specific directory to search in
     * @param {number} maxResults - Maximum number of results to return (default: 50)
     * @returns {Promise<object>} - Search results with file paths
     */
    async searchFiles(pattern, location = null, maxResults = 50, options = {}) {
        return new Promise((resolve) => {
            const cleanPattern = String(pattern || '').trim();
            if (!cleanPattern) {
                resolve({
                    success: false,
                    error: 'Missing file search pattern',
                    files: [],
                    count: 0,
                    message: 'Tell me what file or folder name to search for.'
                });
                return;
            }
            // Escape special characters for PowerShell
            const escapedPattern = cleanPattern.replace(/'/g, "''");
            const searchLocation = this.resolveFriendlyLocation(location || os.homedir());
            const includeFolders = options.includeFolders !== false;
            const latest = Boolean(options.latest);
            
            const psScript = `
                $pattern = '*${escapedPattern}*';
                $searchPath = '${searchLocation.replace(/\\/g, '\\\\')}';
                $maxResults = ${maxResults};
                $includeFolders = ${includeFolders ? '$true' : '$false'};
                $latest = ${latest ? '$true' : '$false'};
                $results = @();

                if (Test-Path $searchPath) {
                    try {
                        $conn = New-Object -ComObject ADODB.Connection -ErrorAction Stop;
                        $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';") | Out-Null;
                        $sql = "SELECT System.ItemName, System.ItemPathDisplay, System.Size, System.FileExtension, System.DateModified FROM SystemIndex WHERE SCOPE='file:$searchPath' AND System.ItemName LIKE '%${escapedPattern}%'";
                        $recordset = $conn.Execute($sql);
                        $count = 0;
                        while ($recordset -and -not $recordset.EOF -and $count -lt $maxResults) {
                            $results += [PSCustomObject]@{
                                Name = $recordset.Fields.Item("System.ItemName").Value;
                                Path = $recordset.Fields.Item("System.ItemPathDisplay").Value;
                                Size = $recordset.Fields.Item("System.Size").Value;
                                Extension = $recordset.Fields.Item("System.FileExtension").Value;
                                LastModified = if ($recordset.Fields.Item("System.DateModified").Value) { ([DateTime]$recordset.Fields.Item("System.DateModified").Value).ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
                            };
                            $recordset.MoveNext();
                            $count++;
                        }
                        $conn.Close() | Out-Null;
                    } catch {}

                    if ($results.Count -eq 0) {
                        try {
                            $items = Get-ChildItem -Path $searchPath -Filter $pattern -Recurse -Depth 5 -ErrorAction SilentlyContinue -Force;
                            if (-not $includeFolders) { $items = $items | Where-Object { -not $_.PSIsContainer } }
                            if ($latest) { $items = $items | Sort-Object LastWriteTime -Descending }
                            $items | Select-Object -First $maxResults | ForEach-Object {
                                $results += [PSCustomObject]@{
                                    Name = $_.Name;
                                    Path = $_.FullName;
                                    Type = if ($_.PSIsContainer) { 'Folder' } else { 'File' };
                                    Size = if ($_.PSIsContainer) { 0 } else { $_.Length };
                                    Extension = if ($_.PSIsContainer) { '' } else { $_.Extension };
                                    LastModified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                                }
                            }
                        } catch {}
                    }
                }

                if ($results.Count -eq 0) {
                    Write-Output '[]'
                } else {
                    $results | ConvertTo-Json -Compress
                }
            `;
            
            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
            
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
                { maxBuffer: 1024 * 1024 * 10, timeout: 15000 }, // 10MB buffer, 15s timeout
                (error, stdout, stderr) => {
                    if (error && !stdout) {
                        console.error('Search error:', stderr);
                        resolve({ 
                            success: false, 
                            error: 'Search failed',
                            files: [] 
                        });
                    } else {
                        try {
                            const results = JSON.parse(stdout.trim() || '[]');
                            const files = Array.isArray(results) ? results : [results];
                            resolve({ 
                                success: true, 
                                files: files,
                                count: files.length,
                                message: files.length
                                    ? `Found ${files.length} item(s) matching "${cleanPattern}"`
                                    : `No items found matching "${cleanPattern}"`
                            });
                        } catch (parseError) {
                            console.error('Parse error:', parseError);
                            resolve({ 
                                success: false, 
                                error: 'Failed to parse search results',
                                files: [] 
                            });
                        }
                    }
                }
            );
        });
    }

    /**
     * Search for files by content
     * @param {string} searchText - Text to search for within files
     * @param {string} location - Directory to search in
     * @param {string} filePattern - File pattern to search (e.g., "*.txt")
     * @returns {Promise<object>} - Files containing the search text
     */
    async searchFileContent(searchText, location = null, filePattern = '*.*') {
        return new Promise((resolve) => {
            const searchLocation = location || os.homedir();
            const escapedText = searchText.replace(/'/g, "''");
            
            const psScript = `
                $searchPath = '${searchLocation}'
                $pattern = '${filePattern}'
                $searchText = '${escapedText}'
                $results = @()
                
                if (Test-Path $searchPath) {
                    Get-ChildItem -Path $searchPath -Filter $pattern -Recurse -ErrorAction SilentlyContinue -File |
                        ForEach-Object {
                            try {
                                $content = Get-Content $_.FullName -ErrorAction SilentlyContinue
                                if ($content -match $searchText) {
                                    $results += [PSCustomObject]@{
                                        Name = $_.Name
                                        Path = $_.FullName
                                        Size = $_.Length
                                    }
                                }
                            } catch { }
                        } | Select-Object -First 20
                }
                
                if ($results.Count -eq 0) {
                    Write-Output "[]"
                } else {
                    $results | ConvertTo-Json -Compress
                }
            `;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`,
                { maxBuffer: 1024 * 1024 * 10 },
                (error, stdout) => {
                    if (error) {
                        resolve({ success: false, error: 'Content search failed', files: [] });
                    } else {
                        try {
                            const results = JSON.parse(stdout.trim() || '[]');
                            const files = Array.isArray(results) ? results : [results];
                            resolve({ 
                                success: true, 
                                files: files,
                                count: files.length,
                                message: `Found ${files.length} file(s) containing "${searchText}"`
                            });
                        } catch {
                            resolve({ success: false, error: 'Failed to parse results', files: [] });
                        }
                    }
                }
            );
        });
    }

    // ============================================
    // Bulk File Operations
    // ============================================

    /**
     * Delete multiple files at once
     * @param {string[]} filePaths - Array of file paths to delete
     * @returns {Promise<object>} - Deletion results
     */
    async deleteFiles(filePaths) {
        const results = {
            success: true,
            deleted: [],
            failed: [],
            message: ''
        };

        for (const filePath of filePaths) {
            try {
                await fs.unlink(filePath);
                results.deleted.push(filePath);
            } catch (error) {
                results.failed.push({ path: filePath, error: error.message });
                results.success = false;
            }
        }

        results.message = `Deleted ${results.deleted.length}/${filePaths.length} file(s)`;
        return results;
    }

    /**
     * Copy multiple files to a destination
     * @param {string[]} filePaths - Array of source file paths
     * @param {string} destination - Destination directory
     * @returns {Promise<object>} - Copy results
     */
    async copyFiles(filePaths, destination) {
        const results = {
            success: true,
            copied: [],
            failed: [],
            message: ''
        };

        // Ensure destination exists
        try {
            await fs.mkdir(destination, { recursive: true });
        } catch (error) {
            return { 
                success: false, 
                error: `Failed to create destination: ${error.message}` 
            };
        }

        for (const filePath of filePaths) {
            try {
                const fileName = path.basename(filePath);
                const destPath = path.join(destination, fileName);
                await fs.copyFile(filePath, destPath);
                results.copied.push({ from: filePath, to: destPath });
            } catch (error) {
                results.failed.push({ path: filePath, error: error.message });
                results.success = false;
            }
        }

        results.message = `Copied ${results.copied.length}/${filePaths.length} file(s) to ${destination}`;
        return results;
    }

    /**
     * Move multiple files to a destination
     * @param {string[]} filePaths - Array of source file paths
     * @param {string} destination - Destination directory
     * @returns {Promise<object>} - Move results
     */
    async moveFiles(filePaths, destination) {
        const results = {
            success: true,
            moved: [],
            failed: [],
            message: ''
        };

        // Ensure destination exists
        try {
            await fs.mkdir(destination, { recursive: true });
        } catch (error) {
            return { 
                success: false, 
                error: `Failed to create destination: ${error.message}` 
            };
        }

        for (const filePath of filePaths) {
            try {
                const fileName = path.basename(filePath);
                const destPath = path.join(destination, fileName);
                await fs.rename(filePath, destPath);
                results.moved.push({ from: filePath, to: destPath });
            } catch (error) {
                results.failed.push({ path: filePath, error: error.message });
                results.success = false;
            }
        }

        results.message = `Moved ${results.moved.length}/${filePaths.length} file(s) to ${destination}`;
        return results;
    }

    /**
     * Create copies of a file with different names
     * @param {string} sourceFile - Source file path
     * @param {string[]} newNames - Array of new file names
     * @param {string} destination - Optional destination directory (default: same as source)
     * @returns {Promise<object>} - Copy results
     */
    async createCopies(sourceFile, newNames, destination = null) {
        const results = {
            success: true,
            created: [],
            failed: [],
            message: ''
        };

        const destDir = destination || path.dirname(sourceFile);

        try {
            await fs.mkdir(destDir, { recursive: true });
        } catch (error) {
            return { 
                success: false, 
                error: `Failed to access destination: ${error.message}` 
            };
        }

        for (const newName of newNames) {
            try {
                const destPath = path.join(destDir, newName);
                await fs.copyFile(sourceFile, destPath);
                results.created.push(destPath);
            } catch (error) {
                results.failed.push({ name: newName, error: error.message });
                results.success = false;
            }
        }

        results.message = `Created ${results.created.length}/${newNames.length} copies`;
        return results;
    }

    // ============================================
    // Application Management
    // ============================================

    /**
     * Search for installed applications
     * @param {string} appName - Application name to search for
     * @returns {Promise<object>} - Found applications
     */
    async searchApplications(appName) {
        return new Promise((resolve) => {
            const escapedName = appName.replace(/'/g, "''");
            
            // Build PowerShell with properly escaped variables to prevent CMD/PowerShell double-quoted expansion
            const psScript = `
                \`$appName = '${escapedName}';
                \`$pattern = '*' + \`$appName + '*';
                \`$results = @();
                try {
                    Get-StartApps | Where-Object Name -like \`$pattern | Select-Object -First 10 | ForEach-Object {
                        \`$results += [PSCustomObject]@{ Name = \`$PSItem.Name; AppId = \`$PSItem.AppID; Type = 'StartMenu' }
                    }
                } catch {};
                try {
                    \`$regPaths = @('HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*', 'HKLM:\\\\Software\\\\WOW6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*', 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*');
                    foreach (\`$regPath in \`$regPaths) {
                        Get-ItemProperty \`$regPath -ErrorAction SilentlyContinue | Where-Object DisplayName -like \`$pattern | Select-Object -First 5 | ForEach-Object {
                            \`$results += [PSCustomObject]@{ Name = \`$PSItem.DisplayName; Publisher = \`$PSItem.Publisher; Version = \`$PSItem.DisplayVersion; InstallLocation = \`$PSItem.InstallLocation; Type = 'Installed' }
                        }
                    }
                } catch {};
                try {
                    \`$exePattern = '*' + \`$appName + '*.exe';
                    Get-ChildItem 'C:\\\\Program Files' -Filter \`$exePattern -Recurse -ErrorAction SilentlyContinue -Depth 2 | Select-Object -First 3 | ForEach-Object {
                        \`$results += [PSCustomObject]@{ Name = \`$PSItem.BaseName; Path = \`$PSItem.FullName; Type = 'Executable' }
                    }
                } catch {};
                if (\`$results.Count -eq 0) {
                    Write-Output '[]'
                } else {
                    \`$results | Select-Object -First 20 | ConvertTo-Json -Compress
                }
            `.replace(/\n/g, ' ').trim();
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`,
                { maxBuffer: 1024 * 1024 * 10 },
                (error, stdout, stderr) => {
                    if (error && !stdout) {
                        console.error('App search error:', stderr);
                        resolve({ 
                            success: false, 
                            error: 'Application search failed',
                            applications: [] 
                        });
                    } else {
                        try {
                            const results = JSON.parse(stdout.trim() || '[]');
                            const apps = Array.isArray(results) ? results : [results];
                            resolve({ 
                                success: true, 
                                applications: apps,
                                count: apps.length,
                                message: `Found ${apps.length} application(s) matching "${appName}"`
                            });
                        } catch (parseError) {
                            console.error('Parse error:', parseError, 'Output:', stdout);
                            resolve({ 
                                success: false, 
                                error: 'Failed to parse results',
                                applications: [] 
                            });
                        }
                    }
                }
            );
        });
    }

    /**
     * Get list of currently running applications
     * @returns {Promise<object>} - Running applications
     */
    async getRunningApplications() {
        return new Promise((resolve) => {
            const psScript = `Get-Process | Where-Object MainWindowTitle -ne '' | Select-Object -First 30 | ForEach-Object { [PSCustomObject]@{ Name = \`$PSItem.ProcessName; Title = \`$PSItem.MainWindowTitle; Id = \`$PSItem.Id; Memory = [math]::Round(\`$PSItem.WorkingSet64 / 1MB, 2) } } | ConvertTo-Json -Compress`;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
                if (error && !stdout) {
                    console.error('Running apps error:', stderr);
                    resolve({ 
                        success: false, 
                        error: 'Failed to get running applications',
                        applications: [] 
                    });
                } else {
                    try {
                        const results = JSON.parse(stdout.trim() || '[]');
                        const apps = Array.isArray(results) ? results : [results];
                        resolve({ 
                            success: true, 
                            applications: apps,
                            count: apps.length
                        });
                    } catch (parseError) {
                        console.error('Parse error:', parseError, 'Output:', stdout);
                        resolve({ 
                            success: false, 
                            error: 'Failed to parse results',
                            applications: [] 
                        });
                    }
                }
            });
        });
    }

    /**
     * Close application by name or process ID
     * @param {string|number} identifier - Application name or process ID
     * @returns {Promise<object>} - Close result
     */
    async closeApplication(identifier) {
        return new Promise((resolve) => {
            const isNumeric = !isNaN(identifier);
            const psScript = isNumeric 
                ? `Stop-Process -Id ${identifier} -Force -ErrorAction Stop`
                : `Stop-Process -Name "${identifier.replace(/"/g, '""')}" -Force -ErrorAction Stop`;
            
            exec(`powershell -NoProfile -Command "${psScript}"`, (error) => {
                if (error) {
                    resolve({ 
                        success: false, 
                        error: `Failed to close application: ${error.message}` 
                    });
                } else {
                    resolve({ 
                        success: true, 
                        message: `Closed application: ${identifier}` 
                    });
                }
            });
        });
    }

    // ============================================
    // File Type Operations
    // ============================================

    /**
     * Get files by type/extension
     * @param {string} fileType - File extension (e.g., "pdf", "jpg", "docx")
     * @param {string} location - Directory to search in
     * @param {number} maxResults - Maximum results
     * @returns {Promise<object>} - Files of specified type
     */
    async getFilesByType(fileType, location = null, maxResults = 50) {
        const ext = fileType.startsWith('.') ? fileType : `.${fileType}`;
        const pattern = `*${ext}`;
        return this.searchFiles(pattern.replace('.', ''), location, maxResults);
    }

    /**
     * Get file information
     * @param {string} filePath - Path to file
     * @returns {Promise<object>} - Detailed file information
     */
    async getFileInfo(filePath) {
        return new Promise((resolve) => {
            const psScript = `
                $file = Get-Item '${filePath.replace(/'/g, "''")}' -ErrorAction Stop
                $info = [PSCustomObject]@{
                    Name = $file.Name
                    FullPath = $file.FullName
                    Extension = $file.Extension
                    Size = $file.Length
                    SizeReadable = if ($file.Length -gt 1GB) { 
                        "{0:N2} GB" -f ($file.Length / 1GB) 
                    } elseif ($file.Length -gt 1MB) { 
                        "{0:N2} MB" -f ($file.Length / 1MB) 
                    } elseif ($file.Length -gt 1KB) { 
                        "{0:N2} KB" -f ($file.Length / 1KB) 
                    } else { 
                        "$($file.Length) bytes" 
                    }
                    Created = $file.CreationTime.ToString('yyyy-MM-dd HH:mm:ss')
                    Modified = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                    Accessed = $file.LastAccessTime.ToString('yyyy-MM-dd HH:mm:ss')
                    IsReadOnly = $file.IsReadOnly
                    Attributes = $file.Attributes.ToString()
                }
                $info | ConvertTo-Json -Compress
            `;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to get file info' });
                } else {
                    try {
                        const info = JSON.parse(stdout.trim());
                        resolve({ success: true, info: info });
                    } catch {
                        resolve({ success: false, error: 'Failed to parse file info' });
                    }
                }
            });
        });
    }

    /**
     * Open file with default application
     * @param {string} filePath - Path to file
     * @returns {Promise<object>} - Open result
     */
    async openFile(filePath) {
        const target = String(filePath || '').trim();
        if (!target) return { success: false, error: 'No path provided' };
        try {
            const stat = await fs.stat(target);
            if (stat.isDirectory()) {
                const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: false });
                child.unref();
                return { success: true, message: `Opened ${path.basename(target) || target}`, path: target };
            }
        } catch (error) {
            return { success: false, error: `Path not found: ${target}` };
        }

        const child = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        return { success: true, message: `Opened ${path.basename(target)}`, path: target };
    }

    /**
     * Open file location in Explorer
     * @param {string} filePath - Path to file
     * @returns {Promise<object>} - Open result
     */
    async showInExplorer(filePath) {
        return new Promise((resolve) => {
            exec(`explorer.exe /select,"${filePath}"`, (error) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to open Explorer' });
                } else {
                    resolve({ success: true, message: 'Opened in Explorer' });
                }
            });
        });
    }

    /**
     * Uninstall/delete an application using ONLY built-in Windows uninstallers
     * @param {string} appName - Name of the application to uninstall
     * @param {boolean} force - If true, runs uninstaller silently. If false, just detects uninstallers.
     * @returns {Promise<Object>} Uninstallation result
     */
    async uninstallApplication(appName, force = false) {
        return new Promise((resolve, reject) => {
            const escapedName = appName.replace(/'/g, "''");
            
            // ONLY uses official Windows-registered uninstallers - NEVER deletes files manually
            const psScript = `$appName = '${escapedName}'; $pattern = '*' + $appName + '*'; $results = @(); $uninstallPaths = @('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); foreach ($path in $uninstallPaths) { try { $apps = Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like $pattern -and $_.UninstallString }; if ($apps) { foreach ($app in $apps) { $results += @{DisplayName=$app.DisplayName; UninstallString=$app.UninstallString; InstallLocation=$app.InstallLocation; Publisher=$app.Publisher} } } } catch {} }; $count = $results.Count; $msg = "Found " + $count + " built-in uninstallers"; $output = @{success=$true; found=$count; applications=$results; message=$msg; note='Uses ONLY official Windows-registered uninstallers'}; $output | ConvertTo-Json -Depth 3`;

            exec(`powershell -Command "${psScript}"`, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                if (stderr && !stdout) {
                    reject(new Error(`PowerShell error: ${stderr}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (parseError) {
                    console.error('Failed to parse result:', stdout);
                    resolve({
                        success: false,
                        found: 0,
                        applications: [],
                        message: 'Failed to detect uninstallers',
                        details: [stdout, stderr].filter(Boolean)
                    });
                }
            });
        });
    }

    /**
     * Move an application to a different location (WARNING: May break the application)
     * @param {string} appName - Name of the application
     * @param {string} newLocation - New installation directory
     * @param {boolean} updateRegistry - Whether to attempt registry updates
     * @returns {Promise<Object>} Move result with warnings
     */
    async moveApplication(appName, newLocation, updateRegistry = true) {
        return new Promise((resolve, reject) => {
            const escapedName = appName.replace(/'/g, "''");
            const escapedLocation = newLocation.replace(/'/g, "''").replace(/\\/g, '\\\\\\\\');
            const updateReg = updateRegistry ? '$true' : '$false';
            
            const psScript = `$appName = '${escapedName}'; $newLocation = '${escapedLocation}'; $updateReg = ${updateReg}; $results = @{success=$false; warnings=@(); moved=@(); registryUpdates=@(); message=''}; $installDir = $null; $appDisplayName = $null; $uninstallPaths = @('HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*', 'HKLM:\\\\Software\\\\WOW6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*', 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*'); $pattern = "*$appName*"; foreach ($path in $uninstallPaths) { $apps = Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like $pattern }; if ($apps) { $app = $apps | Select-Object -First 1; $appDisplayName = $app.DisplayName; if ($app.InstallLocation) { $installDir = $app.InstallLocation; break; } elseif ($app.UninstallString) { $exePath = $app.UninstallString -replace '"', '' -replace ' /.*', ''; if (Test-Path $exePath) { $installDir = Split-Path $exePath -Parent; break; } } } }; if (-not $installDir) { $results.message = "Could not find installation directory for: $appName"; $results | ConvertTo-Json -Depth 3; exit; }; $results.warnings += "WARNING: Moving applications can break them!"; if (-not (Test-Path $newLocation)) { New-Item -ItemType Directory -Path $newLocation -Force | Out-Null; }; $targetDir = Join-Path $newLocation (Split-Path $installDir -Leaf); try { Move-Item -Path $installDir -Destination $targetDir -Force -ErrorAction Stop; $results.moved += @{from=$installDir; to=$targetDir}; $results.success = $true; $results.message = "Moved $appDisplayName from $installDir to $targetDir"; $results.warnings += "Shortcuts may need manual updates"; } catch { $results.success = $false; $results.message = "Failed to move: $($_.Exception.Message)"; }; $results | ConvertTo-Json -Depth 3`;

            exec(`powershell -Command "${psScript}"`, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                if (stderr && !stdout) {
                    reject(new Error(`PowerShell error: ${stderr}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (parseError) {
                    console.error('Failed to parse result:', stdout);
                    resolve({
                        success: false,
                        warnings: ['Failed to parse PowerShell output'],
                        moved: [],
                        registryUpdates: [],
                        message: 'Failed to move application',
                        details: [stdout, stderr].filter(Boolean)
                    });
                }
            });
        });
    }
}

module.exports = new FileManager();
