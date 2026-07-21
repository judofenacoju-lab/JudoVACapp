# Build APK local — JDK + Android SDK dans .tools (sans admin)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
$JdkDir = Join-Path $Tools 'jdk-17'
$SdkDir = Join-Path $Tools 'android-sdk'
$ApkOut = Join-Path $Root 'release'

New-Item -ItemType Directory -Force -Path $Tools, $ApkOut | Out-Null

function Ensure-Jdk {
  if (Test-Path (Join-Path $JdkDir 'bin\java.exe')) { return }
  Write-Host '>> Téléchargement OpenJDK 17...'
  $zip = Join-Path $Tools 'jdk.zip'
  Invoke-WebRequest -Uri 'https://aka.ms/download-jdk/microsoft-jdk-17.0.15-windows-x64.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $Tools -Force
  Remove-Item $zip -Force
  $extracted = Get-ChildItem $Tools -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
  if ($extracted -and $extracted.FullName -ne $JdkDir) {
    if (Test-Path $JdkDir) { Remove-Item $JdkDir -Recurse -Force }
    Rename-Item $extracted.FullName 'jdk-17'
  }
}

function Ensure-AndroidSdk {
  $sdkmanager = Join-Path $SdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkmanager)) {
    Write-Host '>> Téléchargement Android command-line tools...'
    $zip = Join-Path $Tools 'cmdline-tools.zip'
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
    $cliRoot = Join-Path $SdkDir 'cmdline-tools'
    New-Item -ItemType Directory -Force -Path (Join-Path $cliRoot 'latest') | Out-Null
    Expand-Archive -Path $zip -DestinationPath $Tools -Force
    Remove-Item $zip -Force
    $extracted = Join-Path $Tools 'cmdline-tools'
    if (Test-Path $extracted) {
      Copy-Item (Join-Path $extracted '*') (Join-Path $cliRoot 'latest') -Recurse -Force
      Remove-Item $extracted -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host '>> Acceptation licences Android SDK...'
  $env:JAVA_HOME = $JdkDir
  $env:ANDROID_HOME = $SdkDir
  $env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;" + $env:Path

  $yesFile = Join-Path $Tools 'sdk-yes.txt'
  ('y' + [Environment]::NewLine) * 80 | Set-Content -Path $yesFile -Encoding ascii
  Get-Content $yesFile | & $sdkmanager --sdk_root=$SdkDir --licenses 2>&1 | Out-Null

  Write-Host '>> Installation composants Android SDK...'
  Get-Content $yesFile | & $sdkmanager --sdk_root=$SdkDir 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 'ndk;26.1.10909125' 2>&1
}

Ensure-Jdk
Ensure-AndroidSdk

$env:JAVA_HOME = $JdkDir
$env:ANDROID_HOME = $SdkDir
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;" + $env:Path

Set-Location $Root

if (-not (Test-Path (Join-Path $Root 'android'))) {
  Write-Host '>> expo prebuild...'
  npx expo prebuild --platform android --non-interactive
}

Write-Host '>> Gradle assembleDebug...'
Set-Location (Join-Path $Root 'android')
.\gradlew.bat assembleDebug --no-daemon

$apk = Get-ChildItem -Recurse -Filter '*debug*.apk' (Join-Path $Root 'android\app\build\outputs\apk') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
  $apk = Get-ChildItem -Recurse -Filter '*.apk' (Join-Path $Root 'android\app\build\outputs\apk') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $apk) { throw 'APK introuvable après build' }

$dest = Join-Path $ApkOut 'JudoVACapp-scanner-1.0.0.apk'
Copy-Item $apk.FullName $dest -Force
Write-Host ">> APK prêt : $dest"
