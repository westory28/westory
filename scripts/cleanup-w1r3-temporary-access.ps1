$ErrorActionPreference = "Stop"

$accessToken = gcloud auth print-access-token
$headers = @{
  Authorization         = "Bearer $accessToken"
  "x-goog-user-project" = "westory-staging-177587430482"
}
$parent =
  "projects/894916304910/apps/1:894916304910:web:bd8c8a9e3ed8bd1620dc5f"
$debugTokens = Invoke-RestMethod `
  -Headers $headers `
  -Uri "https://firebaseappcheck.googleapis.com/v1/$parent/debugTokens"
$targets = @(
  $debugTokens.debugTokens |
    Where-Object { $_.displayName -like "w1r3-*" }
)

foreach ($item in $targets) {
  Invoke-RestMethod `
    -Headers $headers `
    -Uri "https://firebaseappcheck.googleapis.com/v1/$($item.name)" `
    -Method Delete | Out-Null
}

$sharePath = Join-Path $env:TEMP "westory-w1r3-share-url.tmp"
if (Test-Path -LiteralPath $sharePath) {
  $resolvedSharePath = (Resolve-Path -LiteralPath $sharePath).Path
  if ($resolvedSharePath -ne [System.IO.Path]::GetFullPath($sharePath)) {
    throw "Unexpected share file path."
  }
  Remove-Item -LiteralPath $resolvedSharePath -Force
}

[pscustomobject]@{
  DeletedDebugTokens = $targets.Count
  ShareFileRemaining = Test-Path -LiteralPath $sharePath
}
