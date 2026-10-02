# Popline installer for Windows.
#   powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
# Per-user install (no admin): copies the panel into %APPDATA%\Adobe\CEP\extensions\Popline,
# enables unsigned extensions, and downloads ffmpeg, whisper.cpp and a speech model.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$WhisperVersion = 'v1.7.6'
$Model = 'base'   # tiny | base | small | large-v3-turbo-q5_0  (more can be downloaded from the panel)

$src  = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\Popline'
Write-Host "Installing Popline to $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($item in 'CSXS','css','js','jsx','fonts','bin','models','index.html','.debug') {
  Copy-Item -Recurse -Force (Join-Path $src $item) $dest
}

foreach ($v in 9..13) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Force -Path $key | Out-Null
  Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Write-Host "Enabled PlayerDebugMode for CSXS 9-13"

$bin = Join-Path $dest 'bin'
$tmp = Join-Path $env:TEMP ('popline-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# ffmpeg: reuse Grabbit's copy if it's installed, else download (gyan.dev essentials includes libass + libvpx).
$grabbit = Join-Path $env:APPDATA 'Adobe\CEP\extensions\Grabbit\bin'
if (-not (Test-Path (Join-Path $bin 'ffmpeg.exe'))) {
  if (Test-Path (Join-Path $grabbit 'ffmpeg.exe')) {
    Write-Host "Reusing ffmpeg from Grabbit"
    Copy-Item (Join-Path $grabbit 'ffmpeg.exe'), (Join-Path $grabbit 'ffprobe.exe') $bin -Force
  } else {
    Write-Host "Downloading ffmpeg (~100 MB)..."
    $zip = Join-Path $tmp 'ffmpeg.zip'
    Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
    Expand-Archive $zip -DestinationPath (Join-Path $tmp 'ff') -Force
    Get-ChildItem (Join-Path $tmp 'ff') -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination $bin -Force
  }
}

Write-Host "Downloading whisper.cpp $WhisperVersion..."
$wzip = Join-Path $tmp 'whisper.zip'
Invoke-WebRequest "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperVersion/whisper-bin-x64.zip" -OutFile $wzip
Expand-Archive $wzip -DestinationPath (Join-Path $tmp 'w') -Force
Get-ChildItem (Join-Path $tmp 'w') -Recurse -Include *.exe, *.dll | Copy-Item -Destination $bin -Force

$models = Join-Path $dest 'models'
$mfile = Join-Path $models "ggml-$Model.bin"
if (-not (Test-Path $mfile)) {
  Write-Host "Downloading the '$Model' speech model..."
  Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin" -OutFile $mfile
}

Remove-Item -Recurse -Force $tmp
Write-Host ""
Write-Host "Done. Restart Premiere Pro, then open Window > Extensions > Popline Captions." -ForegroundColor Green
