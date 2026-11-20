# Deploy the Office Board to D:\apps\office-board and start it on port 3006 (no admin rights needed).
# ASCII only (Windows PowerShell 5.1). Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy_office_board.ps1            (copy + restart)
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy_office_board.ps1 -DryRun    (show what would happen)
# It never touches the data folder, never stops a process it cannot attribute by image name AND command line, and it
# does not create services, startup entries or firewall rules.
# Order: copy first (the running copy has its code in memory), prove the copy byte for byte, then stop old + start new,
# then prove the answer comes from a process born after this run began. A failed start is retried once.
#   ... -Target <scratch folder> -Port <scratch port>   rehearses the whole run away from the real installation
param([switch]$DryRun, [int]$Port = 3006, [string]$Target = "D:\apps\office-board")
$ErrorActionPreference = "Stop"
$began = Get-Date
$src  = Join-Path $PSScriptRoot "app"
$dst  = $Target
$data = Join-Path $dst "data"
$node = (Get-Command node.exe).Source
$entry = Join-Path $dst "server.mjs"
$skipDirs = @("test", "data", "_tmp", "node_modules")
$skipFiles = @("NOTES_impl.md")
Write-Output ("source : " + $src)
Write-Output ("target : " + $dst)
Write-Output ("node   : " + $node)
if (-not (Test-Path (Join-Path $src "server.mjs"))) { throw "server.mjs not found in the source folder" }

function Get-BoardProcess {
  # An instance of THIS installation: node.exe whose command line names the target's server.mjs by absolute path
  # (this script and the launcher start it that way), or a relative "server.mjs" together with the target's data
  # folder (an older launcher or a hand start from inside the folder). Anything else is never touched.
  $e = $entry.ToLower(); $d = $data.ToLower()
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine.ToLower().Contains($e) -or ($_.CommandLine.ToLower().Contains(' server.mjs ') -and $_.CommandLine.ToLower().Contains($d)))
  })
}
function Get-SourceFiles {
  $root = (Resolve-Path $src).Path
  Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $top = $rel.Split([char]92)[0]
    ($skipDirs -notcontains $top) -and ($skipFiles -notcontains $rel)
  } | ForEach-Object { $_.FullName.Substring($root.Length + 1) }
}
function Start-Board {
  # detached (parented to WMI, so it outlives this session); the absolute exe path is required here
  $su = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
  $su.ShowWindow = 0
  $cmd = '"' + $node + '" "' + $entry + '" --port ' + $Port + ' --data "' + $data + '"'
  $r = ([wmiclass]"Win32_Process").Create($cmd, $dst, $su)
  # Write-Host, not Write-Output: anything written to the output stream here would become part of the return value
  Write-Host ("start: return " + $r.ReturnValue + ", pid " + $r.ProcessId)
  if ($r.ReturnValue -ne 0) { return 0 }
  return [int]$r.ProcessId
}
function Test-Board([int]$procId) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $Port + "/api/session") -TimeoutSec 3
      if ($resp.StatusCode -eq 200 -and $resp.Content -match '"signed_in"') {
        $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $procId)
        if ($p -and $p.CreationDate -gt $began) { return $true }
      }
    } catch { }
  }
  return $false
}

# @(...) at every call: a function that returns ONE object hands back a scalar, and .Count on it is empty in 5.1
$old = @(Get-BoardProcess)
Write-Output ("running instances from the target: " + $old.Count)
$busy = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($busy.Count -gt 0 -and $old.Count -eq 0) {
  throw ("port " + $Port + " is already in use by process " + $busy[0].OwningProcess + " which is not this app: nothing changed")
}
$files = @(Get-SourceFiles)
Write-Output ("files to install: " + $files.Count)
if ($DryRun) { $files | ForEach-Object { Write-Output ("  " + $_) }; Write-Output "DRY RUN: nothing copied, nothing started"; exit 0 }

New-Item -ItemType Directory -Force $dst | Out-Null
New-Item -ItemType Directory -Force $data | Out-Null
robocopy $src $dst /E /R:2 /W:1 /XD $skipDirs /XF $skipFiles /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw ("robocopy failed with code " + $LASTEXITCODE + ": the running copy was not stopped") }
$diff = 0
foreach ($rel in $files) {
  $a = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $src $rel)).Hash
  $t = Join-Path $dst $rel
  if (-not (Test-Path -LiteralPath $t)) { $diff++; Write-Output ("missing in target: " + $rel); continue }
  if ($a -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $t).Hash) { $diff++; Write-Output ("differs in target: " + $rel) }
}
Write-Output ("installed files identical to the source: " + ($files.Count - $diff) + " of " + $files.Count)
if ($diff -ne 0) { throw "the copy is not identical to the source: the running copy was not stopped" }

$bat = Join-Path $dst "start-office-board.bat"
# the launcher runs run-office-board.ps1, which starts server.mjs by absolute path (the same form Start-Board uses, so a
# redeploy can recognise a launcher-started instance), refuses a second copy, and shows where to open the board
$line = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dst "run-office-board.ps1") + '" -Port ' + $Port
Set-Content -Path $bat -Value ("@echo off`r`n" + $line + "`r`npause`r`n") -Encoding ascii
# and its pair: stops only the board started from this folder and says whether the port is free
$line = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dst "stop-office-board.ps1") + '" -Port ' + $Port
Set-Content -Path (Join-Path $dst "stop-office-board.bat") -Value ("@echo off`r`n" + $line + "`r`npause`r`n") -Encoding ascii

foreach ($p in $old) {
  Write-Output ("stopping old instance pid " + $p.ProcessId)
  Stop-Process -Id $p.ProcessId -Force
}
if ($old.Count -gt 0) { Start-Sleep -Seconds 1 }
$ok = $false
for ($try = 1; $try -le 2 -and -not $ok; $try++) {
  $procId = Start-Board
  if ($procId -gt 0) { $ok = Test-Board $procId }
  if (-not $ok) { Write-Output ("attempt " + $try + ": the app did not answer") }
}
Write-Output ("health: /api/session answered by a process started after " + $began.ToString("HH:mm:ss") + " = " + $ok)
if (-not $ok) { throw ("the app did not come up: read " + (Join-Path $data "server.log")) }
$now = @(Get-BoardProcess)
Write-Output ("instances now: " + $now.Count + " (pid " + (($now | ForEach-Object { $_.ProcessId }) -join ", ") + ")")
if ($now.Count -ne 1) { throw "expected exactly one running instance" }
Write-Output "RESULT: PASS"
