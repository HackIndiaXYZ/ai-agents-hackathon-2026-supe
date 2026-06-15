const { spawn } = require('child_process');

/**
 * Excel COM Automation Module with Persistent PowerShell Session
 * Keeps Excel application alive across multiple operations
 */

class ExcelCOM {
    constructor() {
        this.psProcess = null;
        this.isReady = false;
    }

    /**
     * Initialize persistent PowerShell session with Excel COM object
     */
    async initializeSession() {
        if (this.psProcess) {
            return; // Already initialized
        }

        return new Promise((resolve, reject) => {
            this.psProcess = spawn('powershell.exe', ['-NoProfile', '-NoExit', '-Command', '-'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let outputBuffer = '';
            const readyMarker = '>>EXCEL_READY<<';
            const errorMarker = '>>EXCEL_ERROR:';

            this.psProcess.stdout.on('data', (data) => {
                outputBuffer += data.toString();
                if (outputBuffer.includes(readyMarker)) {
                    this.isReady = true;
                    resolve();
                } else if (outputBuffer.includes(errorMarker)) {
                    const parts = outputBuffer.split(errorMarker);
                    const errorMsg = parts[1] ? parts[1].split('<<')[0] : 'COM Activation Failed';
                    this.psProcess.kill();
                    this.psProcess = null;
                    this.isReady = false;
                    reject(new Error(errorMsg.trim()));
                }
            });

            this.psProcess.stderr.on('data', (data) => {
                console.error('Excel PS Error:', data.toString());
            });

            // Initialize Excel COM object with error handling
            this.psProcess.stdin.write(`
                try {
                    $global:ExcelApp = New-Object -ComObject Excel.Application
                    $global:ExcelApp.Visible = $true
                    Write-Output '${readyMarker}'
                } catch {
                    Write-Output "${errorMarker} $($_.Exception.Message) <<"
                }
            \n`);
        });
    }

    /**
     * Execute command in persistent PowerShell session
     */
    async executeInSession(command, waitForOutput = true) {
        if (!this.psProcess) {
            await this.initializeSession();
        }

        return new Promise((resolve, reject) => {
            const outputMarker = `>>OUTPUT_${Date.now()}<<`;
            let output = '';
            let isCollecting = false;

            const dataHandler = (data) => {
                const text = data.toString();
                if (text.includes(outputMarker)) {
                    isCollecting = false;
                    this.psProcess.stdout.removeListener('data', dataHandler);
                    resolve(output.trim());
                } else if (isCollecting) {
                    output += text;
                } else if (text.includes('>>START<<')) {
                    isCollecting = true;
                }
            };

            if (waitForOutput) {
                this.psProcess.stdout.on('data', dataHandler);
            }

            this.psProcess.stdin.write(`
                try {
                    Write-Output '>>START<<'
                    ${command}
                    Write-Output '${outputMarker}'
                } catch {
                    Write-Output "ERROR: $($_.Exception.Message)"
                    Write-Output '${outputMarker}'
                }
            \n`);

            if (!waitForOutput) {
                setTimeout(() => resolve('OK'), 500);
            }
        });
    }

    /**
     * Close the persistent session
     */
    closeSession() {
        if (this.psProcess) {
            this.psProcess.stdin.write('$global:ExcelApp.Quit()\nexit\n');
            this.psProcess = null;
            this.isReady = false;
        }
    }

    /**
     * Create a new Excel workbook
     */
    async createWorkbook() {
        const command = `
            $global:ExcelWorkbook = $global:ExcelApp.Workbooks.Add()
            $global:ExcelSheet = $global:ExcelWorkbook.ActiveSheet
            Write-Output "Workbook created successfully"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'New workbook created' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Open an existing Excel workbook
     */
    async openWorkbook(filepath) {
        const expandedPath = filepath.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
        const command = `
            $fullPath = [System.IO.Path]::GetFullPath('${expandedPath.replace(/\\/g, '\\\\')}')
            if (Test-Path $fullPath) {
                $global:ExcelWorkbook = $global:ExcelApp.Workbooks.Open($fullPath)
                $global:ExcelSheet = $global:ExcelWorkbook.ActiveSheet
                Write-Output "Workbook opened: $fullPath"
            } else {
                Write-Output "ERROR: File not found: $fullPath"
            }
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Workbook opened' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Write data to cell
     */
    async writeCell(row, col, value) {
        const command = `
            $global:ExcelSheet.Cells.Item(${row}, ${col}) = "${value}"
            Write-Output "Cell updated"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: `Cell (${row}, ${col}) updated` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Write array of data to Excel (starting from A1)
     */
    async writeData(data) {
        const commands = data.map((row, rowIndex) => 
            row.map((cell, colIndex) => 
                `$global:ExcelSheet.Cells.Item(${rowIndex + 1}, ${colIndex + 1}) = "${cell}"`
            ).join('\n')
        ).join('\n');
        
        const command = `
            ${commands}
            Write-Output "Data written"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Data written to Excel' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Add new worksheet
     */
    async addWorksheet(name = '') {
        const command = name
            ? `
                $sheet = $global:ExcelWorkbook.Worksheets.Add()
                $sheet.Name = "${name}"
                $global:ExcelSheet = $sheet
                Write-Output "Worksheet added"
            `
            : `
                $global:ExcelSheet = $global:ExcelWorkbook.Worksheets.Add()
                Write-Output "Worksheet added"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Worksheet added' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Create chart from selected data
     */
    async createChart(chartType = 'column') {
        const chartTypes = {
            'column': '-4100',
            'bar': '-4111',
            'line': '-4101',
            'pie': '-4102',
            'area': '-4098',
        };
        
        const typeValue = chartTypes[chartType.toLowerCase()] || '-4100';
        
        const command = `
            $chart = $global:ExcelSheet.Shapes.AddChart().Chart
            $chart.ChartType = ${typeValue}
            Write-Output "Chart created"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Chart created' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Format cell with comprehensive styling options
     */
    async formatCell(row, col, options = {}) {
        const boldValue = options.bold ? '$true' : '$false';
        const italicValue = options.italic ? '$true' : '$false';
        const fontSize = options.font_size || options.fontSize || 11;
        const fontName = options.font_name || options.fontName || '';
        const underline = options.underline ? '2' : '-4142'; // xlUnderlineStyleNone
        
        let commands = [];
        
        commands.push(`$cell = $global:ExcelSheet.Cells.Item(${row}, ${col})`);
        commands.push(`$cell.Font.Bold = ${boldValue}`);
        commands.push(`$cell.Font.Italic = ${italicValue}`);
        commands.push(`$cell.Font.Size = ${fontSize}`);
        commands.push(`$cell.Font.Underline = ${underline}`);
        
        if (fontName) {
            commands.push(`$cell.Font.Name = "${fontName}"`);
        }
        
        // Text color
        if (options.color) {
            const colorMap = {
                'red': '255',
                'blue': '16711680',
                'green': '32768',
                'yellow': '65535',
                'black': '0',
                'white': '16777215',
                'orange': '42495',
                'purple': '8388736'
            };
            const colorValue = colorMap[options.color.toLowerCase()] || '0';
            commands.push(`$cell.Font.Color = ${colorValue}`);
        }
        
        // Background color
        if (options.bg_color || options.bgColor) {
            const bgColor = options.bg_color || options.bgColor;
            const colorMap = {
                'red': '255',
                'blue': '16711680',
                'green': '32768',
                'yellow': '65535',
                'lightblue': '16764057',
                'lightgreen': '13434828',
                'gray': '12632256',
                'orange': '42495'
            };
            const colorValue = colorMap[bgColor.toLowerCase()] || '16777215';
            commands.push(`$cell.Interior.Color = ${colorValue}`);
        }
        
        // Borders
        if (options.border) {
            commands.push(`$cell.Borders.LineStyle = 1`); // xlContinuous
            commands.push(`$cell.Borders.Weight = 2`); // xlThin
        }
        
        // Horizontal alignment
        if (options.alignment) {
            const alignMap = {
                'left': '-4131',
                'center': '-4108',
                'right': '-4152'
            };
            const alignValue = alignMap[options.alignment.toLowerCase()] || '-4131';
            commands.push(`$cell.HorizontalAlignment = ${alignValue}`);
        }
        
        const command = commands.join('\n            ') + '\n            Write-Output "Cell formatted"';
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Cell formatted' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Format a range of cells
     */
    async formatRange(startRow, startCol, endRow, endCol, options = {}) {
        const boldValue = options.bold ? '$true' : '$false';
        const fontSize = options.font_size || options.fontSize || 11;
        
        let commands = [];
        commands.push(`$range = $global:ExcelSheet.Range($global:ExcelSheet.Cells.Item(${startRow}, ${startCol}), $global:ExcelSheet.Cells.Item(${endRow}, ${endCol}))`);
        
        if (options.bold !== undefined) {
            commands.push(`$range.Font.Bold = ${boldValue}`);
        }
        
        if (options.font_size || options.fontSize) {
            commands.push(`$range.Font.Size = ${fontSize}`);
        }
        
        if (options.bg_color || options.bgColor) {
            const bgColor = options.bg_color || options.bgColor;
            const colorMap = {
                'red': '255',
                'blue': '16711680',
                'green': '32768',
                'yellow': '65535',
                'lightblue': '16764057',
                'lightgreen': '13434828'
            };
            const colorValue = colorMap[bgColor.toLowerCase()] || '16777215';
            commands.push(`$range.Interior.Color = ${colorValue}`);
        }
        
        if (options.border) {
            commands.push(`$range.Borders.LineStyle = 1`);
            commands.push(`$range.Borders.Weight = 2`);
        }
        
        const command = commands.join('\n            ') + '\n            Write-Output "Range formatted"';
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Range formatted' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Auto-fit columns
     */
    async autoFitColumns() {
        const command = `
            $global:ExcelSheet.UsedRange.Columns.AutoFit()
            Write-Output "Columns auto-fitted"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Columns auto-fitted' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Save workbook
     */
    async saveWorkbook(filename = null) {
        const command = filename 
            ? `
                $fullPath = [System.IO.Path]::GetFullPath('${filename.replace(/\\/g, '\\\\')}')
                $global:ExcelWorkbook.SaveAs($fullPath)
                Write-Output "Workbook saved to: $fullPath"
            `
            : `
                $global:ExcelWorkbook.Save()
                Write-Output "Workbook saved"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Workbook saved' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove borders from range or entire sheet
     */
    async removeBorders(startRow = null, startCol = null, endRow = null, endCol = null) {
        const command = (startRow && startCol && endRow && endCol)
            ? `
                $range = $global:ExcelSheet.Range($global:ExcelSheet.Cells.Item(${startRow}, ${startCol}), $global:ExcelSheet.Cells.Item(${endRow}, ${endCol}))
                $range.Borders.LineStyle = 0
                Write-Output "Borders removed from range"
            `
            : `
                $global:ExcelSheet.UsedRange.Borders.LineStyle = 0
                Write-Output "All borders removed"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Borders removed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Clear all formatting from range or entire sheet
     */
    async clearFormatting(startRow = null, startCol = null, endRow = null, endCol = null) {
        const command = (startRow && startCol && endRow && endCol)
            ? `
                $range = $global:ExcelSheet.Range($global:ExcelSheet.Cells.Item(${startRow}, ${startCol}), $global:ExcelSheet.Cells.Item(${endRow}, ${endCol}))
                $range.ClearFormats()
                Write-Output "Formatting cleared from range"
            `
            : `
                $global:ExcelSheet.UsedRange.ClearFormats()
                Write-Output "All formatting cleared"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Formatting cleared' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove background color from cells
     */
    async removeBackgroundColor(startRow = null, startCol = null, endRow = null, endCol = null) {
        const command = (startRow && startCol && endRow && endCol)
            ? `
                $range = $global:ExcelSheet.Range($global:ExcelSheet.Cells.Item(${startRow}, ${startCol}), $global:ExcelSheet.Cells.Item(${endRow}, ${endCol}))
                $range.Interior.ColorIndex = 0
                Write-Output "Background color removed from range"
            `
            : `
                $global:ExcelSheet.UsedRange.Interior.ColorIndex = 0
                Write-Output "All background colors removed"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Background colors removed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Change font for entire sheet or specific range
     */
    async changeFont(fontName, fontSize = null, startRow = null, startCol = null, endRow = null, endCol = null) {
        if (startRow && startCol && endRow && endCol) {
            const sizeCmd = fontSize ? `$range.Font.Size = ${fontSize}` : '';
            const command = `
                $range = $global:ExcelSheet.Range($global:ExcelSheet.Cells.Item(${startRow}, ${startCol}), $global:ExcelSheet.Cells.Item(${endRow}, ${endCol}))
                $range.Font.Name = "${fontName}"
                ${sizeCmd}
                Write-Output "Font changed to ${fontName} for range"
            `;
            await this.executeInSession(command);
        } else {
            const sizeCmd = fontSize ? `$global:ExcelSheet.UsedRange.Font.Size = ${fontSize}` : '';
            const command = `
                $global:ExcelSheet.UsedRange.Font.Name = "${fontName}"
                ${sizeCmd}
                Write-Output "Font changed to ${fontName} for entire sheet"
            `;
            await this.executeInSession(command);
        }
        
        try {
            return { success: true, message: `Font changed to ${fontName}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if Excel is running with active workbook
     */
    async isExcelActive() {
        return this.isReady && this.psProcess !== null;
    }
}

module.exports = new ExcelCOM();
