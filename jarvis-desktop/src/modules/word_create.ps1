param(
    [string]$JsonPath,
    [string]$OutputPath
)

try {
    # 1. Read and parse the JSON structure
    if (-not (Test-Path $JsonPath)) {
        Write-Error "JSON file not found: $JsonPath"
        exit 1
    }
    
    $jsonContent = Get-Content -Raw -Path $JsonPath -Encoding UTF8
    $structure = ConvertFrom-Json -InputObject $jsonContent
    
    # 2. Start Word COM object
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0 # wdAlertsNone
    
    # 3. Create a new document
    $doc = $word.Documents.Add()
    
    # Define alignments
    $wdAlignParagraphCenter = 1
    $wdAlignParagraphLeft = 0
    
    # Write Title
    if ($structure.title) {
        $para = $doc.Paragraphs.Add()
        $para.Range.Text = $structure.title
        $para.Range.Font.Name = "Calibri"
        $para.Range.Font.Size = 24
        $para.Range.Font.Bold = $true
        $para.Alignment = $wdAlignParagraphCenter
        $para.Range.InsertParagraphAfter()
    }
    
    # Write Subtitle
    if ($structure.subtitle) {
        $para = $doc.Paragraphs.Add()
        $para.Range.Text = $structure.subtitle
        $para.Range.Font.Name = "Calibri"
        $para.Range.Font.Size = 13
        $para.Range.Font.Italic = $true
        $para.Alignment = $wdAlignParagraphCenter
        $para.Range.InsertParagraphAfter()
    }
    
    # Process sections
    foreach ($section in $structure.sections) {
        # Add heading
        if ($section.heading) {
            $para = $doc.Paragraphs.Add()
            $para.Range.Text = $section.heading
            $para.Range.Font.Name = "Calibri"
            $level = $section.level
            if ($null -eq $level) { $level = 2 }
            
            if ($level -eq 1) {
                $para.Range.Font.Size = 18
                $para.Range.Font.Bold = $true
            } elseif ($level -eq 2) {
                $para.Range.Font.Size = 14
                $para.Range.Font.Bold = $true
            } else {
                $para.Range.Font.Size = 12
                $para.Range.Font.Bold = $true
            }
            $para.Alignment = $wdAlignParagraphLeft
            $para.Range.InsertParagraphAfter()
        }
        
        # Add content blocks
        foreach ($block in $section.content) {
            if ($block.type -eq "paragraph" -and $block.text) {
                $para = $doc.Paragraphs.Add()
                # strip out any markdown bold formatting like **text**
                $cleanText = $block.text -replace '\*\*(.*?)\*\*','$1'
                $para.Range.Text = $cleanText
                $para.Range.Font.Name = "Calibri"
                $para.Range.Font.Size = 12
                $para.Range.Font.Bold = $false
                $para.Range.Font.Italic = $false
                $para.Alignment = $wdAlignParagraphLeft
                $para.Range.InsertParagraphAfter()
            }
            elseif (($block.type -eq "bullet" -or $block.type -eq "numbered") -and $block.items) {
                $index = 1
                foreach ($item in $block.items) {
                    $para = $doc.Paragraphs.Add()
                    if ($block.type -eq "bullet") {
                        $para.Range.Text = "•  $item"
                    } else {
                        $para.Range.Text = "$index.  $item"
                        $index++
                    }
                    $para.Range.Font.Name = "Calibri"
                    $para.Range.Font.Size = 12
                    $para.Range.Font.Bold = $false
                    $para.Range.Font.Italic = $false
                    $para.Alignment = $wdAlignParagraphLeft
                    $para.Range.InsertParagraphAfter()
                }
            }
        }
    }
    
    # Save the document
    $doc.SaveAs([ref]$OutputPath)
    $doc.Close()
    $word.Quit()
    
    # Release COM references
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    
    Write-Output "SUCCESS"
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
