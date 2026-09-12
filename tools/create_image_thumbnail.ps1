param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$DestinationPath,
    [Parameter(Mandatory=$true)][int]$MaxDimension,
    [Parameter(Mandatory=$true)][int]$MaxHeight,
    [Parameter(Mandatory=$true)][int]$Quality
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourceStream = $null
$sourceImage = $null
$bitmap = $null
$graphics = $null
$parameters = $null
try {
    $sourceStream = [System.IO.File]::OpenRead($SourcePath)
    $sourceImage = [System.Drawing.Image]::FromStream($sourceStream, $false, $false)
    if ([long]$sourceImage.Width * [long]$sourceImage.Height -gt 64000000) {
        throw 'Image pixel dimensions exceed thumbnail limit'
    }
    # 尊重手机照片方向，仅改变预览，原始文件保持不变。
    if ($sourceImage.PropertyIdList -contains 274) {
        $orientation = $sourceImage.GetPropertyItem(274).Value[0]
        $rotation = @{ 2=4; 3=2; 4=6; 5=5; 6=1; 7=7; 8=3 }
        if ($rotation.ContainsKey([int]$orientation)) {
            $sourceImage.RotateFlip([System.Drawing.RotateFlipType]$rotation[[int]$orientation])
        }
    }
    # App 会把图片撑满消息宽度，固定画布比例才能限制长截图的显示高度。
    $canvasHeight = [Math]::Min($MaxDimension, $MaxHeight)
    $scale = [Math]::Min(1.0, [Math]::Min($MaxDimension / [double]$sourceImage.Width, $canvasHeight / [double]$sourceImage.Height))
    $width = [Math]::Max(1, [int][Math]::Round($sourceImage.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($sourceImage.Height * $scale))
    $bitmap = New-Object System.Drawing.Bitmap($MaxDimension, $canvasHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::FromArgb(48, 48, 48))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $left = [int][Math]::Floor(($MaxDimension - $width) / 2)
    $top = [int][Math]::Floor(($canvasHeight - $height) / 2)
    $graphics.FillRectangle([System.Drawing.Brushes]::White, $left, $top, $width, $height)
    $graphics.DrawImage($sourceImage, $left, $top, $width, $height)
    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    $bitmap.Save($DestinationPath, $encoder, $parameters)
    @{ width=$MaxDimension; height=$canvasHeight; left=$left; top=$top; imageWidth=$width; imageHeight=$height; originalWidth=$sourceImage.Width; originalHeight=$sourceImage.Height } | ConvertTo-Json -Compress
} finally {
    if ($parameters) { $parameters.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($sourceImage) { $sourceImage.Dispose() }
    if ($sourceStream) { $sourceStream.Dispose() }
}
