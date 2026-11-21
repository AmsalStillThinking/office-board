# Stop the Office Board that runs from the folder this script is installed in.
# ASCII only (Windows PowerShell 5.1). stop-office-board.bat runs it; by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File stop-office-board.ps1 [-Port 3006]
# Stops ONLY node.exe processes started from this folder (never another program on the port), then waits until they
# are gone and says whether the port is free. Not running: says so. Exit code 0 = no board from this folder runs.
# A forced stop, as the deploy does: every saved change is already committed in PostgreSQL, and a transaction left
# half done is rolled back by PostgreSQL itself.
param([int]$Port = 3006)
$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$entry = Join-Path $root "server.mjs"
$data  = Join-Path $root "data"

function Get-Board {
  # the same test as the deploy: this folder's server.mjs by absolute path, or a relative "server.mjs" together with
  # this folder's data folder (a start by hand from inside the folder)
  $e = $entry.ToLower(); $d = $data.ToLower()
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine.ToLower().Contains($e) -or ($_.CommandLine.ToLower().Contains(' server.mjs ') -and $_.CommandLine.ToLower().Contains($d)))
  })
}
function Show-Port {
  $l = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($l.Count -eq 0) { Write-Output ("Port " + $Port + " kosong."); return }
  $o = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $l[0].OwningProcess)
  Write-Output ("Port " + $Port + " dipakai program lain: " + $o.Name + " (pid " + $l[0].OwningProcess + "), tidak disentuh.")
}

$board = @(Get-Board)
if ($board.Count -eq 0) {
  Write-Output "Papan Tugas Kantor tidak sedang berjalan dari folder ini."
  Show-Port
  exit 0
}
$ids = @($board | ForEach-Object { [int]$_.ProcessId })
foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
for ($i = 0; $i -lt 20; $i++) {
  if (@(Get-Board).Count -eq 0) {
    Write-Output ("Papan Tugas Kantor dimatikan (pid " + ($ids -join ", ") + ").")
    Show-Port
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
Write-Output ("GAGAL: papan masih berjalan setelah 10 detik (pid " + ((@(Get-Board) | ForEach-Object { $_.ProcessId }) -join ", ") + ").")
exit 1
