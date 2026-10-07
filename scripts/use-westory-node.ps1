# Dot-source this file to use the Functions Node major in the current terminal:
# . .\scripts\use-westory-node.ps1
param([string]$NodeDirectory)

$requiredMajor = (Get-Content (Join-Path $PSScriptRoot '../functions/package.json') -Raw | ConvertFrom-Json).engines.node
$currentVersion = & node --version
if ($LASTEXITCODE -ne 0) {
    throw 'Node.js is unavailable. Install the Node version in functions/package.json first.'
}

if ($NodeDirectory) {
    $candidate = Get-Item -LiteralPath (Join-Path $NodeDirectory 'node.exe') -ErrorAction Stop
} elseif ($currentVersion -notmatch "^v$requiredMajor\.") {
    $toolRoot = Join-Path $env:LOCALAPPDATA 'Westory/tools'
    $candidate = Get-ChildItem -Path (Join-Path $toolRoot "node-v$requiredMajor.*-win-x64/node.exe") -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Directory.Name -replace '^node-v|\-win-x64$', '') } -Descending |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Node $requiredMajor is required. Extract the official Windows x64 ZIP under $toolRoot or pass -NodeDirectory."
    }
} else {
    $candidate = $null
}

if ($candidate) {
    $candidateVersion = & $candidate.FullName --version
    if ($LASTEXITCODE -ne 0 -or $candidateVersion -notmatch "^v$requiredMajor\.") {
        throw "The selected runtime must be Node $requiredMajor."
    }
    $env:PATH = "$($candidate.Directory.FullName);$env:PATH"
}

$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
Write-Output "Westory runtime: $(node --version); FUNCTIONS_DISCOVERY_TIMEOUT=$env:FUNCTIONS_DISCOVERY_TIMEOUT"
