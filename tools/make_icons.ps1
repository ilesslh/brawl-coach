param([string]$OutDir)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-Icon([int]$size, [string]$path, [bool]$maskable, [bool]$rounded) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $bg = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#14112B'))
    if ($rounded) {
        $r = [int]($size * 0.22); $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $gp.AddArc(0, 0, 2*$r, 2*$r, 180, 90); $gp.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
        $gp.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90); $gp.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90); $gp.CloseFigure()
        $g.FillPath($bg, $gp)
    } else { $g.FillRectangle($bg, 0, 0, $size, $size) }

    $scale = if ($maskable) { 0.56 } else { 0.70 }
    $o = $size * (1 - $scale) / 2; $u = $size * $scale
    $yellow = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#FFC93C'))
    $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#5AA9FF'))
    $outline = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#0B0920'), [float]($u * 0.035))
    # Three rising bars (stats) with a yellow lightning bolt across them
    $bars = @(@(0.06, 0.62, 0.22, 0.32), @(0.36, 0.44, 0.22, 0.50), @(0.66, 0.22, 0.22, 0.72))
    foreach ($b in $bars) {
        $rect = [System.Drawing.RectangleF]::new([float]($o + $b[0]*$u), [float]($o + $b[1]*$u), [float]($b[2]*$u), [float]($b[3]*$u))
        $g.FillRectangle($blue, $rect)
    }
    $P = { param($x, $y) [System.Drawing.PointF]::new([float]($o + $x * $u), [float]($o + $y * $u)) }
    $bolt = [System.Drawing.PointF[]]@((& $P 0.58 0.00), (& $P 0.18 0.56), (& $P 0.46 0.56), (& $P 0.34 1.00), (& $P 0.84 0.38), (& $P 0.54 0.38), (& $P 0.70 0.00))
    $g.FillPolygon($yellow, $bolt); $g.DrawPolygon($outline, $bolt)
    $g.Dispose(); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
New-Icon 192 (Join-Path $OutDir 'icon-192.png') $false $true
New-Icon 512 (Join-Path $OutDir 'icon-512.png') $false $true
New-Icon 512 (Join-Path $OutDir 'icon-maskable-512.png') $true $false
New-Icon 180 (Join-Path $OutDir 'apple-touch-icon.png') $false $false
