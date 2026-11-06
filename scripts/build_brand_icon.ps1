Add-Type -AssemblyName System.Drawing

$brandDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'custom_components/ma_maison_chauffage/brand'
New-Item -ItemType Directory -Force -Path $brandDir | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = 2 * $radius
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Write-BrandIcon([int]$size, [string]$filename) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.ScaleTransform($size / 256.0, $size / 256.0)
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(49, 88, 213))
    $heat = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 194, 71), 10)
    $heat.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $heat.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $heatPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    foreach ($x in @(88, 128, 168)) {
        $heatPath.AddBezier($x, 94, $x - 13, 83, $x - 13, 72, $x, 61)
        $heatPath.AddBezier($x, 61, $x + 13, 50, $x + 13, 39, $x, 28)
    }
    $backgroundPath = New-RoundedPath 12 12 232 232 52
    $graphics.FillPath($background, $backgroundPath)
    $graphics.DrawPath($heat, $heatPath)

    $radiator = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $panelPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(36, 68, 169), 7)
    $panelPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $panelPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $supportPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 7)
    $supportPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $supportPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $bodyPath = New-RoundedPath 48 108 160 92 13
    $graphics.FillPath($radiator, $bodyPath)
    foreach ($x in @(82, 113, 144, 175)) { $graphics.DrawLine($panelPen, $x, 125, $x, 183) }
    $graphics.DrawLine($supportPen, 75, 197, 75, 208)
    $graphics.DrawLine($supportPen, 181, 197, 181, 208)
    $graphics.DrawLine($supportPen, 69, 208, 81, 208)
    $graphics.DrawLine($supportPen, 175, 208, 187, 208)

    $bitmap.Save((Join-Path $brandDir $filename), [System.Drawing.Imaging.ImageFormat]::Png)
    $background.Dispose(); $heat.Dispose(); $heatPath.Dispose(); $backgroundPath.Dispose()
    $radiator.Dispose(); $panelPen.Dispose(); $supportPen.Dispose(); $bodyPath.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

Write-BrandIcon 256 'icon.png'
Write-BrandIcon 512 'icon@2x.png'
