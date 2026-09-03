# Invoked by tauri.conf.json's bundle.windows.signCommand for every .exe/.msi/.dll the
# bundler produces. Tauri substitutes the file to sign for %1, so this script always
# receives exactly one path argument.
#
# The actual certificate is never committed - .github/workflows/release.yml imports it from
# the WINDOWS_CERTIFICATE / WINDOWS_CERTIFICATE_PASSWORD secrets into the current user's
# certificate store and exports its thumbprint as WINDOWS_CERTIFICATE_THUMBPRINT before the
# build step runs. See docs/developers/guides/desktop-app.md for the full release-signing setup.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$FilePath
)

$ErrorActionPreference = 'Stop'

# No certificate configured: ship this build unsigned rather than failing the release.
# Accepted risk for a portfolio/personal deployment (TODO.md D1, docs/desktop/download.md) -
# add the WINDOWS_CERTIFICATE / WINDOWS_CERTIFICATE_PASSWORD secrets to sign for real.
if (-not $env:WINDOWS_CERTIFICATE_THUMBPRINT) {
    Write-Warning 'sign-windows.ps1: WINDOWS_CERTIFICATE_THUMBPRINT is not set - leaving this build unsigned.'
    exit 0
}

$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (-not $signtool) {
    $signtool = Get-ChildItem -Path 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\x64\*' } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) {
    Write-Error 'sign-windows.ps1: signtool.exe not found. Install the Windows SDK.'
    exit 1
}

$timestampUrl = if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }

& $signtool sign /sha1 $env:WINDOWS_CERTIFICATE_THUMBPRINT /fd sha256 /tr $timestampUrl /td sha256 $FilePath
exit $LASTEXITCODE
