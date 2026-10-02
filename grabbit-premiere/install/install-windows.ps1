# Grabbit installer for Windows.
# Run from the grabbit-premiere folder:
#   powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
# Installs per-user (no admin): copies the panel into %APPDATA%\Adobe\CEP\extensions,
# enables unsigned extensions, and downloads yt-dlp, ffmpeg/ffprobe and deno into bin\.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$src  = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\Grabbit'

Write-Host "Installing Grabbit to $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($item in 'CSXS','css','js','jsx','bin','index.html','.debug') {
  Copy-Item -Recurse -Force (Join-Path $src $item) $dest
}

# Unsigned extensions only load with PlayerDebugMode on (one key per CEP version).
foreach ($v in 9..13) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Force -Path $key | Out-Null
  Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Write-Host "Enabled PlayerDebugMode for CSXS 9-13"

$bin = Join-Path $dest 'bin'
$tmp = Join-Path $env:TEMP ('grabbit-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "Downloading yt-dlp..."
Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $bin 'yt-dlp.exe')

if (-not (Test-Path (Join-Path $bin 'ffmpeg.exe'))) {
  Write-Host "Downloading ffmpeg (gyan.dev essentials build, ~100 MB)..."
  $zip = Join-Path $tmp 'ffmpeg.zip'
  Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp -Force
  Get-ChildItem $tmp -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination $bin -Force
}

Write-Host "Downloading deno (JavaScript runtime yt-dlp needs for YouTube)..."
$dzip = Join-Path $tmp 'deno.zip'
Invoke-WebRequest 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile $dzip
Expand-Archive $dzip -DestinationPath $bin -Force

Remove-Item -Recurse -Force $tmp
Write-Host ""
Write-Host "Done. Restart Premiere Pro, then open Window > Extensions > Grabbit." -ForegroundColor Green
