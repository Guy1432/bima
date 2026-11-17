param(
  [Parameter(Mandatory = $true)][string]$InFile,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Width = 2560,
  [int]$ThumbWidth = 480
)
# Renders every slide of a PowerPoint deck to PNG via PowerPoint COM automation.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$app = New-Object -ComObject PowerPoint.Application
$hadOpen = $false
try { $hadOpen = $app.Presentations.Count -gt 0 } catch { $hadOpen = $false }

# ReadOnly = msoTrue(-1), Untitled = msoFalse(0), WithWindow = msoFalse(0)
$pres = $app.Presentations.Open($InFile, -1, 0, 0)
try {
  $sw = [double]$pres.PageSetup.SlideWidth
  $sh = [double]$pres.PageSetup.SlideHeight
  $H = [int][math]::Round($Width * $sh / $sw)
  $TH = [int][math]::Round($ThumbWidth * $sh / $sw)
  $hidden = @()
  foreach ($s in $pres.Slides) {
    $i = $s.SlideIndex
    $s.Export((Join-Path $OutDir ("slide_" + $i + ".png")), "PNG", $Width, $H)
    $s.Export((Join-Path $OutDir ("thumb_" + $i + ".png")), "PNG", $ThumbWidth, $TH)
    $hidden += [bool]($s.SlideShowTransition.Hidden -eq -1)
  }
  $info = [ordered]@{
    count  = $pres.Slides.Count
    width  = $sw
    height = $sh
    hidden = $hidden
  }
  $json = ConvertTo-Json $info -Compress
  [System.IO.File]::WriteAllText((Join-Path $OutDir "info.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
}
finally {
  $pres.Close()
  if (-not $hadOpen) { $app.Quit() }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
