$ErrorActionPreference = "Stop"

$stagingUrl = $env:WESTORY_STAGING_URL.TrimEnd("/")
if ([string]::IsNullOrWhiteSpace($stagingUrl)) {
  throw "WESTORY_STAGING_URL is required."
}
$stagingUri = [Uri]$stagingUrl
if (
  $stagingUri.Scheme -ne "https" -or
  $stagingUri.Host -notmatch
    "^westory-staging-[a-z0-9]+-bbbs-projects-44f9da30[.]vercel[.]app$"
) {
  throw "Invalid Dedicated Staging deployment URL."
}

$sharePath = Join-Path $env:TEMP "westory-w1r3-share-url.tmp"
$resolvedSharePath = (Resolve-Path -LiteralPath $sharePath).Path
$expectedSharePath = [System.IO.Path]::GetFullPath($sharePath)

if ($resolvedSharePath -ne $expectedSharePath) {
  throw "Unexpected share file path."
}

$sourceShareUrl = (Get-Content -Raw -LiteralPath $resolvedSharePath).Trim()
$sourceShareUri = [Uri]$sourceShareUrl

if (
  $sourceShareUri.Scheme -ne "https" -or
  $sourceShareUri.Query -notmatch "_vercel_share="
) {
  throw "Invalid Dedicated Staging share URL."
}
$shareBuilder = [UriBuilder]$stagingUri
$shareBuilder.Query = $sourceShareUri.Query.TrimStart("?")
$shareUrl = $shareBuilder.Uri.AbsoluteUri

function New-W1R3Password {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $encoded = [Convert]::ToBase64String($bytes) -replace "[^A-Za-z0-9]", "A"
  return "$encoded!9a"
}

function Set-StagingPassword {
  param(
    [Parameter(Mandatory = $true)][string] $Uid,
    [Parameter(Mandatory = $true)][string] $Password,
    [Parameter(Mandatory = $true)][hashtable] $Headers
  )

  $body = @{
    localId           = $Uid
    password          = $Password
    targetProjectId   = "westory-staging-177587430482"
    returnSecureToken = $false
  } | ConvertTo-Json

  Invoke-RestMethod `
    -Headers $Headers `
    -Uri "https://identitytoolkit.googleapis.com/v1/accounts:update" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body | Out-Null
}

function Test-StagingPasswordSignIn {
  param(
    [Parameter(Mandatory = $true)][string] $Email,
    [Parameter(Mandatory = $true)][string] $Password,
    [Parameter(Mandatory = $true)][string] $ApiKey
  )

  $body = @{
    email             = $Email
    password          = $Password
    returnSecureToken = $true
  } | ConvertTo-Json

  Invoke-RestMethod `
    -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$ApiKey" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body | Out-Null
}

$adminPassword = New-W1R3Password
$negativePassword = New-W1R3Password
$accessToken = gcloud auth print-access-token
$headers = @{
  Authorization         = "Bearer $accessToken"
  "x-goog-user-project" = "westory-staging-177587430482"
}
$appCheckDebugToken = [guid]::NewGuid().ToString()
$appCheckDebugTokenResourceName = $null
$sdkConfigResponse = firebase apps:sdkconfig WEB `
  "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f" `
  --project westory-staging-177587430482 `
  --json | ConvertFrom-Json
$firebaseApiKey = $sdkConfigResponse.result.sdkConfig.apiKey

if ([string]::IsNullOrWhiteSpace($firebaseApiKey)) {
  throw "Dedicated Staging Firebase API key is unavailable."
}

try {
  $debugTokenBody = @{
    displayName = "w1r3-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
    token       = $appCheckDebugToken
  } | ConvertTo-Json
  $debugTokenResponse = Invoke-RestMethod `
    -Headers $headers `
    -Uri "https://firebaseappcheck.googleapis.com/v1/projects/894916304910/apps/1:894916304910:web:bd8c8a9e3ed8bd1620dc5f/debugTokens" `
    -Method Post `
    -ContentType "application/json" `
    -Body $debugTokenBody
  $appCheckDebugTokenResourceName = $debugTokenResponse.name

  Set-StagingPassword `
    -Uid "nJcE7XlP39NvP5JRGIVjHP7WRdr1" `
    -Password $adminPassword `
    -Headers $headers
  Set-StagingPassword `
    -Uid "VtkiQ7ooiyWgbdGmXE1kkDUMgw52" `
    -Password $negativePassword `
    -Headers $headers
  Test-StagingPasswordSignIn `
    -Email "westoria28@gmail.com" `
    -Password $adminPassword `
    -ApiKey $firebaseApiKey
  Test-StagingPasswordSignIn `
    -Email "w0r-student-01@yongshin-ms.ms.kr" `
    -Password $negativePassword `
    -ApiKey $firebaseApiKey

  $env:WESTORY_STAGING_URL = $stagingUrl
  $env:WESTORY_VERCEL_SHARE_URL = $shareUrl
  $env:WESTORY_ADMIN_EMAIL = "westoria28@gmail.com"
  $env:WESTORY_ADMIN_PASSWORD = $adminPassword
  $env:WESTORY_NEGATIVE_EMAIL = "w0r-student-01@yongshin-ms.ms.kr"
  $env:WESTORY_NEGATIVE_PASSWORD = $negativePassword
  $env:WESTORY_APPCHECK_DEBUG_TOKEN = $appCheckDebugToken
  $env:WESTORY_PLAYWRIGHT_EXECUTABLE =
    "C:\Program Files\Google\Chrome\Application\chrome.exe"
  $env:NODE_PATH =
    "C:\Users\방재석\AppData\Local\npm-cache\_npx\e41f203b7505f1fb\node_modules"
  $env:WESTORY_W1R3_EVIDENCE_DIR =
    "docs/evidence/w1r3-access-viewports"

  node scripts/verify-w1r3-viewports.cjs
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright evidence failed with exit $LASTEXITCODE."
  }
} finally {
  $env:WESTORY_ADMIN_PASSWORD = $null
  $env:WESTORY_NEGATIVE_PASSWORD = $null
  $env:WESTORY_VERCEL_SHARE_URL = $null
  $env:WESTORY_APPCHECK_DEBUG_TOKEN = $null

  if ($appCheckDebugTokenResourceName) {
    Invoke-RestMethod `
      -Headers $headers `
      -Uri "https://firebaseappcheck.googleapis.com/v1/$appCheckDebugTokenResourceName" `
      -Method Delete | Out-Null
  }

  if (Test-Path -LiteralPath $resolvedSharePath) {
    Remove-Item -LiteralPath $resolvedSharePath -Force
  }
}
