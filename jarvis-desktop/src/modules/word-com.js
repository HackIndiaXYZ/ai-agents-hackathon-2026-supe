const { spawn } = require('child_process');

/**
 * Word COM Automation Module with Persistent PowerShell Session
 * Keeps Word application alive across multiple operations
 */

class WordCOM {
    constructor() {
        this.psProcess = null;
        this.isReady = false;
    }

    /**
     * Initialize persistent PowerShell session with Word COM object
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
            const readyMarker = '>>WORD_READY<<';
            const errorMarker = '>>WORD_ERROR:';

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
                console.error('Word PS Error:', data.toString());
            });

            // Initialize Word COM object with error handling
            this.psProcess.stdin.write(`
                try {
                    $global:WordApp = New-Object -ComObject Word.Application
                    $global:WordApp.Visible = $true
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
            this.psProcess.stdin.write('$global:WordApp.Quit()\nexit\n');
            this.psProcess = null;
            this.isReady = false;
        }
    }

    /**
     * Create a new Word document with content
     */
    async createDocument(title = '', content = '') {
        const command = `
            $global:WordDoc = $global:WordApp.Documents.Add()
            
            if ("${title}") {
                $selection = $global:WordApp.Selection
                $selection.Font.Size = 18
                $selection.Font.Bold = $true
                $selection.TypeText("${title}")
                $selection.TypeParagraph()
                $selection.Font.Size = 12
                $selection.Font.Bold = $false
            }
            
            if ("${content}") {
                $selection = $global:WordApp.Selection
                $selection.TypeText("${content}")
            }
            
            Write-Output "New document created"
        `;
        
        await this.executeInSession(command);
    }

    /**
     * Open an existing Word document
     */
    async openDocument(filepath) {
        const expandedPath = filepath.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
        const command = `
            $fullPath = [System.IO.Path]::GetFullPath('${expandedPath.replace(/\\/g, '\\\\')}')
            if (Test-Path $fullPath) {
                $global:WordDoc = $global:WordApp.Documents.Open($fullPath)
                Write-Output "Document opened: $fullPath"
            } else {
                Write-Output "ERROR: File not found: $fullPath"
            }
        `;
        
        await this.executeInSession(command);
    }

    /**
     * Add paragraph to active document with full styling options
     */
    async addParagraph(text, options = {}) {
        // Support both old and new parameter formats
        if (typeof options === 'number') {
            // Old format: addParagraph(text, fontSize, bold)
            const fontSize = options;
            const bold = arguments[2] || false;
            options = { font_size: fontSize, bold: bold };
        }
        
        const fontSize = options.font_size || options.fontSize || 12;
        const bold = options.bold ? '$true' : '$false';
        const italic = options.italic ? '$true' : '$false';
        const underline = options.underline ? '1' : '0';
        const fontName = options.font_name || options.fontName || 'Calibri';
        const alignment = options.alignment || ''; // left, center, right, justify
        
        let colorCmd = '';
        if (options.color) {
            const colorMap = {
                'red': '255, 0, 0',
                'blue': '0, 0, 255',
                'green': '0, 128, 0',
                'black': '0, 0, 0',
                'white': '255, 255, 255',
                'yellow': '255, 255, 0',
                'orange': '255, 165, 0',
                'purple': '128, 0, 128',
                'gray': '128, 128, 128',
                'brown': '165, 42, 42'
            };
            const rgb = colorMap[options.color.toLowerCase()] || '0, 0, 0';
            colorCmd = `$selection.Font.Color = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::FromArgb(${rgb}))`;
        }
        
        let alignCmd = '';
        if (alignment) {
            const alignMap = {
                'left': '0',
                'center': '1',
                'right': '2',
                'justify': '3'
            };
            alignCmd = `$selection.ParagraphFormat.Alignment = ${alignMap[alignment.toLowerCase()] || '0'}`;
        }
        
        const command = `
            $selection = $global:WordApp.Selection
            $selection.Font.Size = ${fontSize}
            $selection.Font.Bold = ${bold}
            $selection.Font.Italic = ${italic}
            $selection.Font.Underline = ${underline}
            $selection.Font.Name = "${fontName}"
            ${colorCmd}
            ${alignCmd}
            $selection.TypeText("${text}")
            $selection.TypeParagraph()
            Write-Output "Paragraph added"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Paragraph added' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Add heading to active document with optional styling
     */
    async addHeading(text, level = 1, options = {}) {
        const fontName = options.font_name || options.fontName || '';
        const fontSize = options.font_size || options.fontSize || 0;
        const color = options.color || '';
        const bold = options.bold !== undefined ? (options.bold ? '$true' : '$false') : '';
        
        let styleCmd = '';
        if (fontName) {
            styleCmd += `\n            $selection.Font.Name = "${fontName}"`;
        }
        if (fontSize > 0) {
            styleCmd += `\n            $selection.Font.Size = ${fontSize}`;
        }
        if (bold) {
            styleCmd += `\n            $selection.Font.Bold = ${bold}`;
        }
        if (color) {
            const colorMap = {
                'red': '255, 0, 0',
                'blue': '0, 0, 255',
                'green': '0, 128, 0',
                'black': '0, 0, 0',
                'orange': '255, 165, 0',
                'purple': '128, 0, 128'
            };
            const rgb = colorMap[color.toLowerCase()] || '0, 0, 0';
            styleCmd += `\n            $selection.Font.Color = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::FromArgb(${rgb}))`;
        }
        
        const command = `
            $selection = $global:WordApp.Selection
            $selection.Style = "Heading ${level}"
            $selection.TypeText("${text}")${styleCmd}
            $selection.TypeParagraph()
            Write-Output "Heading added"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Heading added' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Insert table in active document
     */
    async insertTable(rows, cols) {
        const command = `
            $range = $global:WordApp.Selection.Range
            $table = $global:WordDoc.Tables.Add($range, ${rows}, ${cols})
            $table.Borders.Enable = $true
            Write-Output "Table inserted"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: `Table (${rows}x${cols}) inserted` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply document theme
     */
    async applyTheme(themeName) {
        const command = `
            $global:WordDoc.ApplyDocumentTheme("${themeName}")
            Write-Output "Theme applied"
        `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: `Theme '${themeName}' applied` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Save active document
     */
    async saveDocument(filename = null) {
        const command = filename 
            ? `
                $fullPath = [System.IO.Path]::GetFullPath('${filename.replace(/\\/g, '\\\\')}')
                $global:WordDoc.SaveAs2($fullPath, 16)
                Write-Output "Document saved to: $fullPath"
            `
            : `
                $global:WordDoc.Save()
                Write-Output "Document saved"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Document saved' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove borders from tables (specific table or all)
     */
    async removeTableBorders(tableNumber = null) {
        const command = tableNumber 
            ? `
                if ($global:WordDoc.Tables.Count -ge ${tableNumber}) {
                    $global:WordDoc.Tables.Item(${tableNumber}).Borders.Enable = $false
                    Write-Output "Borders removed from table ${tableNumber}"
                } else {
                    Write-Output "Table ${tableNumber} not found"
                }
            `
            : `
                foreach ($table in $global:WordDoc.Tables) {
                    $table.Borders.Enable = $false
                }
                Write-Output "All table borders removed"
            `;
        
        try {
            await this.executeInSession(command);
            return { success: true, message: 'Table borders removed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Change font (entire document or specific paragraph range)
     */
    async changeFont(fontName, fontSize = null, startPara = null, endPara = null) {
        if (startPara && endPara) {
            const sizeCmd = fontSize ? `$range.Font.Size = ${fontSize}` : '';
            const command = `
                $start = $global:WordDoc.Paragraphs.Item(${startPara}).Range.Start
                $end = $global:WordDoc.Paragraphs.Item(${endPara}).Range.End
                $range = $global:WordDoc.Range($start, $end)
                $range.Font.Name = "${fontName}"
                ${sizeCmd}
                Write-Output "Font changed to ${fontName} for paragraphs ${startPara}-${endPara}"
            `;
            await this.executeInSession(command);
        } else {
            const sizeCmd = fontSize ? `$global:WordDoc.Content.Font.Size = ${fontSize}` : '';
            const command = `
                $global:WordDoc.Content.Font.Name = "${fontName}"
                ${sizeCmd}
                Write-Output "Font changed to ${fontName} for entire document"
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
     * Remove all formatting (entire document or specific paragraph range)
     */
    async clearFormatting(startPara = null, endPara = null) {
        if (startPara && endPara) {
            const command = `
                $start = $global:WordDoc.Paragraphs.Item(${startPara}).Range.Start
                $end = $global:WordDoc.Paragraphs.Item(${endPara}).Range.End
                $range = $global:WordDoc.Range($start, $end)
                $range.Font.Bold = $false
                $range.Font.Italic = $false
                $range.Font.Underline = 0
                $range.Font.Color = 0
                Write-Output "Formatting cleared for paragraphs ${startPara}-${endPara}"
            `;
            await this.executeInSession(command);
        } else {
            const command = `
                $global:WordDoc.Content.Font.Bold = $false
                $global:WordDoc.Content.Font.Italic = $false
                $global:WordDoc.Content.Font.Underline = 0
                $global:WordDoc.Content.Font.Color = 0
                Write-Output "All formatting cleared from entire document"
            `;
            await this.executeInSession(command);
        }
        
        try {
            return { success: true, message: 'Formatting cleared' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Change text color (entire document or specific paragraph range)
     */
    async changeColor(color, startPara = null, endPara = null) {
        const colorMap = {
            'red': '255, 0, 0',
            'blue': '0, 0, 255',
            'green': '0, 128, 0',
            'black': '0, 0, 0',
            'purple': '128, 0, 128',
            'orange': '255, 165, 0'
        };
        const rgb = colorMap[color.toLowerCase()] || '0, 0, 0';
        
        if (startPara && endPara) {
            const command = `
                [System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null
                $colorValue = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::FromArgb(${rgb}))
                $start = $global:WordDoc.Paragraphs.Item(${startPara}).Range.Start
                $end = $global:WordDoc.Paragraphs.Item(${endPara}).Range.End
                $range = $global:WordDoc.Range($start, $end)
                $range.Font.Color = $colorValue
                Write-Output "Text color changed to ${color} for paragraphs ${startPara}-${endPara}"
            `;
            await this.executeInSession(command);
        } else {
            const command = `
                $global:WordDoc.Content.Font.Color = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::FromArgb(${rgb}))
                Write-Output "Text color changed to ${color} for entire document"
            `;
            await this.executeInSession(command);
        }
        
        try {
            return { success: true, message: `Color changed to ${color}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Read all paragraphs from the active Word document
     * Returns array of { Number, Text } objects
     */
    async readDocumentContent() {
        const command = `
            $paragraphs = @()
            $paraNum = 0
            foreach ($para in $global:WordDoc.Paragraphs) {
                $paraNum++
                $text = $para.Range.Text.Trim()
                if ($text.Length -gt 0) {
                    $paragraphs += [PSCustomObject]@{ Number = $paraNum; Text = $text }
                }
            }
            if ($paragraphs.Count -eq 0) { Write-Output '[]' }
            else { $paragraphs | ConvertTo-Json -Compress }
        `;
        try {
            const raw = await this.executeInSession(command);
            // Extract JSON from output (skip any lines before JSON)
            const jsonMatch = raw.match(/(\[.*\]|\{.*\})/s);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : (raw || '[]'));
            return { success: true, paragraphs: Array.isArray(data) ? data : [data] };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Find and replace text in the active Word document using Word's built-in Find & Replace
     * @param {string} searchText - Text to find
     * @param {string} replacementText - Text to replace with
     * @param {boolean} replaceAll - Replace all occurrences (default: true)
     */
    async findAndReplace(searchText, replacementText, replaceAll = true) {
        const esc = (s) => s.replace(/"/g, '`"').replace(/\n/g, ' ');
        const wdReplaceAll = replaceAll ? 2 : 1;  // wdReplaceAll=2, wdReplaceOne=1
        const command = `
            $find = $global:WordApp.Selection.Find
            $find.ClearFormatting()
            $find.Replacement.ClearFormatting()
            $find.Text = "${esc(searchText)}"
            $find.Replacement.Text = "${esc(replacementText)}"
            $find.Forward = $true
            $find.Wrap = 1
            $find.MatchCase = $false
            $find.MatchWholeWord = $false
            $replaced = $find.Execute($null,$null,$null,$null,$null,$null,$null,$null,$null,$null,${wdReplaceAll})
            Write-Output "Find and replace completed: $replaced"
        `;
        try {
            await this.executeInSession(command);
            return { success: true, message: `Replaced "${searchText}" with "${replacementText}"` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Check if Word is running with active document
     */
    async isWordActive() {
        return this.isReady && this.psProcess !== null;
    }
}

module.exports = new WordCOM();
