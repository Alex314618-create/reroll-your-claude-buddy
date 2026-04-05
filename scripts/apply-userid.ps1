param(
  [Parameter(Mandatory = $true)]
  [string]$UserId,
  [switch]$NoBackup,
  [switch]$KeepCompanion,
  [switch]$KeepAccountUuid
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function ConvertTo-PlainValue {
  param([Parameter(ValueFromPipeline = $true)]$Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) {
      $table[$key] = ConvertTo-PlainValue $Value[$key]
    }
    return $table
  }

  if ($Value -is [pscustomobject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-PlainValue $property.Value
    }
    return $table
  }

  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-PlainValue $item)
    }
    return $items
  }

  return $Value
}

function Read-ConfigObject {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return @{}
  }

  $raw = Get-Content -LiteralPath $Path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{}
  }

  $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
  $plain = ConvertTo-PlainValue $parsed

  if (-not ($plain -is [System.Collections.IDictionary])) {
    throw "Claude config root must be a JSON object."
  }

  return $plain
}

$configPath = if ($env:CLAUDE_CONFIG_PATH) { $env:CLAUDE_CONFIG_PATH } else { Join-Path $HOME ".claude.json" }
$config = Read-ConfigObject -Path $configPath
$backupPath = $null

if ((Test-Path -LiteralPath $configPath) -and -not $NoBackup) {
  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
  $backupPath = "$configPath.buddy-backup-$timestamp"
  Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
}

$config["userID"] = $UserId.Trim()

if (-not $KeepCompanion) {
  $null = $config.Remove("companion")
}

if (-not $KeepAccountUuid -and $config.ContainsKey("oauthAccount")) {
  $oauth = ConvertTo-PlainValue $config["oauthAccount"]
  if ($oauth -is [System.Collections.IDictionary]) {
    $null = $oauth.Remove("accountUuid")
    if ($oauth.Count -eq 0) {
      $null = $config.Remove("oauthAccount")
    } else {
      $config["oauthAccount"] = $oauth
    }
  }
}

$directory = Split-Path -Parent $configPath
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$tempPath = "$configPath.tmp-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$replacePath = "$configPath.replace-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$json = "{0}`n" -f ($config | ConvertTo-Json -Depth 20)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
  [System.IO.File]::WriteAllText($tempPath, $json, $utf8NoBom)

  if (Test-Path -LiteralPath $configPath) {
    Move-Item -LiteralPath $configPath -Destination $replacePath -Force

    try {
      Move-Item -LiteralPath $tempPath -Destination $configPath -Force
    } catch {
      if ((Test-Path -LiteralPath $replacePath) -and -not (Test-Path -LiteralPath $configPath)) {
        Move-Item -LiteralPath $replacePath -Destination $configPath -Force
      }
      throw
    }

    if (Test-Path -LiteralPath $replacePath) {
      Remove-Item -LiteralPath $replacePath -Force -ErrorAction SilentlyContinue
    }
  } else {
    [System.IO.File]::Move($tempPath, $configPath)
  }
} finally {
  if (Test-Path -LiteralPath $tempPath) {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $replacePath) {
    Remove-Item -LiteralPath $replacePath -Force -ErrorAction SilentlyContinue
  }
}

Write-Output "Applied $($config["userID"])"
if ($backupPath) {
  Write-Output "Backup: $backupPath"
}
