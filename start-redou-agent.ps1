param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeBin = "C:\Program Files\nodejs"
$Npm = Join-Path $NodeBin "npm.cmd"

if (Test-Path $NodeBin) {
  $env:Path = "$NodeBin;$env:Path"
}

if (-not (Test-Path $Npm)) {
  throw "Node.js/npm is not installed. Install Node.js LTS, then rerun this script."
}

if ($Build) {
  & $Npm --prefix (Join-Path $Root "desktop") run build
  exit $LASTEXITCODE
}

& $Npm --prefix (Join-Path $Root "desktop") start
exit $LASTEXITCODE
