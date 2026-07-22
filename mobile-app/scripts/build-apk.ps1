# Build APK local — JDK + Android SDK dans .tools (sans admin)
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
# Reutiliser le SDK du scanner si present
$SharedTools = Join-Path (Split-Path $Root -Parent) 'mobile\.tools'
if ((Test-Path (Join-Path $SharedTools 'jdk-17\bin\java.exe')) -and -not (Test-Path (Join-Path $Tools 'jdk-17\bin\java.exe'))) {
  Write-Host '>> Reutilisation SDK mobile/scanner...'
  New-Item -ItemType Directory -Force -Path $Tools | Out-Null
  if (-not (Test-Path (Join-Path $Tools 'jdk-17'))) {
    cmd /c "mklink /J `"$(Join-Path $Tools 'jdk-17')`" `"$(Join-Path $SharedTools 'jdk-17')`""
  }
  if (-not (Test-Path (Join-Path $Tools 'android-sdk'))) {
    cmd /c "mklink /J `"$(Join-Path $Tools 'android-sdk')`" `"$(Join-Path $SharedTools 'android-sdk')`""
  }
}
$JdkDir = Join-Path $Tools 'jdk-17'
$SdkDir = Join-Path $Tools 'android-sdk'
$ApkOut = Join-Path $Root 'release'

New-Item -ItemType Directory -Force -Path $Tools, $ApkOut | Out-Null

function Ensure-Jdk {
  if (Test-Path (Join-Path $JdkDir 'bin\java.exe')) { return }
  Write-Host '>> Telechargement OpenJDK 17...'
  $zip = Join-Path $Tools 'jdk.zip'
  Invoke-WebRequest -Uri 'https://aka.ms/download-jdk/microsoft-jdk-17.0.15-windows-x64.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $Tools -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  $extracted = Get-ChildItem $Tools -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
  if ($extracted -and $extracted.FullName -ne $JdkDir) {
    if (Test-Path $JdkDir) { Remove-Item $JdkDir -Recurse -Force }
    Rename-Item $extracted.FullName 'jdk-17'
  }
}

function Ensure-AndroidSdk {
  $sdkmanager = Join-Path $SdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkmanager)) {
    Write-Host '>> Telechargement Android command-line tools...'
    $zip = Join-Path $Tools 'cmdline-tools.zip'
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
    $cliRoot = Join-Path $SdkDir 'cmdline-tools'
    New-Item -ItemType Directory -Force -Path (Join-Path $cliRoot 'latest') | Out-Null
    Expand-Archive -Path $zip -DestinationPath $Tools -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $extracted = Join-Path $Tools 'cmdline-tools'
    if (Test-Path $extracted) {
      Copy-Item (Join-Path $extracted '*') (Join-Path $cliRoot 'latest') -Recurse -Force
      Remove-Item $extracted -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  $env:JAVA_HOME = $JdkDir
  $env:ANDROID_HOME = $SdkDir
  $env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;" + $env:Path

  $platform = Join-Path $SdkDir 'platforms\android-35'
  if (Test-Path $platform) {
    Write-Host '>> Android SDK deja present — skip install'
    return
  }

  Write-Host '>> Acceptation licences Android SDK...'
  $yesFile = Join-Path $Tools 'sdk-yes.txt'
  ('y' + [Environment]::NewLine) * 80 | Set-Content -Path $yesFile -Encoding ascii
  cmd /c "type `"$yesFile`" | `"$sdkmanager`" --sdk_root=$SdkDir --licenses" | Out-Null

  Write-Host '>> Installation composants Android SDK...'
  cmd /c "type `"$yesFile`" | `"$sdkmanager`" --sdk_root=$SdkDir platform-tools platforms;android-35 build-tools;35.0.0 ndk;26.1.10909125"
}

Ensure-Jdk
Ensure-AndroidSdk

$ErrorActionPreference = 'Stop'
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
if ($LASTEXITCODE -ne 0) { throw "Gradle failed: $LASTEXITCODE" }

$apk = Get-ChildItem -Recurse -Filter '*debug*.apk' (Join-Path $Root 'android\app\build\outputs\apk') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
  $apk = Get-ChildItem -Recurse -Filter '*.apk' (Join-Path $Root 'android\app\build\outputs\apk') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $apk) { throw 'APK introuvable apres build' }

$dest = Join-Path $ApkOut 'JudoVAC-mobile-1.0.0.apk'
Copy-Item $apk.FullName $dest -Force
Write-Host ">> APK pret : $dest"
