# Start the Office Board from the folder this script is installed in, and say where to open it.
# ASCII only (Windows PowerShell 5.1). start-office-board.bat runs it; by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-office-board.ps1 [-Port 3006]
# Already running: says so and shows the addresses, starts nothing. Port held by another program: names it, starts
# nothing. Otherwise starts server.mjs detached (it keeps running when this window closes; it is not a service),
# waits until it answers, and shows the addresses. Exit code 0 = the board answers on the port.
param([int]$Port = 3006)
$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$entry = Join-Path $root "server.mjs"
$data  = Join-Path $root "data"
$log   = Join-Path $data "server.log"

function Stop-Here([string]$why) { Write-Output ("GAGAL: " + $why); exit 1 }
if (-not (Test-Path $entry)) { Stop-Here ("server.mjs tidak ada di " + $root) }
# the source package has test\ next to server.mjs; an installation never does (deploy leaves it out)
if (Test-Path (Join-Path $root "test")) { Stop-Here "ini folder sumber, bukan folder instalasi: jalankan dari folder hasil deploy" }
$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $cmd) { Stop-Here "node.exe tidak ditemukan (perlu Node.js 22.5 atau lebih baru)" }
$node = $cmd.Source

function Get-Board {
  # the same test as the deploy and stop-office-board.ps1: this folder's server.mjs by absolute path (this script, the
  # deploy and the launcher start it that way), or a relative "server.mjs" with this folder's data (a start by hand)
  $e = $entry.ToLower(); $d = $data.ToLower()
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine.ToLower().Contains($e) -or ($_.CommandLine.ToLower().Contains(' server.mjs ') -and $_.CommandLine.ToLower().Contains($d)))
  })
}
function Get-Listener {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Show-Addresses {
  Write-Output ("  Di PC ini           : http://127.0.0.1:" + $Port)
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Output ("  Dari perangkat lain : http://" + $_.IPAddress + ":" + $Port + "   (" + $_.InterfaceAlias + ")") }
  Write-Output ("  Log                 : " + $log)
}

$board = @(Get-Board)
$ids = @($board | ForEach-Object { [int]$_.ProcessId })
$listen = @(Get-Listener)
$mine = @($listen | Where-Object { $ids -contains [int]$_.OwningProcess })
if ($mine.Count -gt 0) {
  Write-Output ("Papan Tugas Kantor sudah berjalan (pid " + $mine[0].OwningProcess + ", port " + $Port + ").")
  Show-Addresses
  exit 0
}
if ($listen.Count -gt 0) {
  $o = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listen[0].OwningProcess)
  Stop-Here ("port " + $Port + " sudah dipakai program lain: " + $o.Name + " (pid " + $listen[0].OwningProcess + "). Tidak ada yang diubah.")
}
if ($board.Count -gt 0) {
  # running from this folder but not listening on this port: a second copy on the same data would be wrong
  Stop-Here ("papan dari folder ini sudah jalan (pid " + ($ids -join ", ") + ") tetapi tidak di port " + $Port + ". Lihat " + $log)
}

# detached (parented to WMI, so it outlives this window); the absolute exe path is required here
$began = Get-Date
$su = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
$su.ShowWindow = 0
$line = '"' + $node + '" "' + $entry + '" --port ' + $Port + ' --data "' + $data + '"'
$r = ([wmiclass]"Win32_Process").Create($line, $root, $su)
if ($r.ReturnValue -ne 0) { Stop-Here ("node tidak bisa dijalankan (kode " + $r.ReturnValue + ")") }
$procId = [int]$r.ProcessId
Write-Output ("Menyalakan Papan Tugas Kantor (pid " + $procId + ") ...")
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  # the answer must come from the process started just now, not from anything else on the port
  $own = @(Get-Listener | Where-Object { [int]$_.OwningProcess -eq $procId })
  if ($own.Count -gt 0) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $Port + "/api/session") -TimeoutSec 3
      if ($resp.StatusCode -eq 200 -and $resp.Content -match '"signed_in"') {
        Write-Output ("Papan Tugas Kantor berjalan (pid " + $procId + ", port " + $Port + "). Jendela ini boleh ditutup.")
        Show-Addresses
        exit 0
      }
    } catch { }
  }
  if (-not (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $procId))) { break }  # it stopped: no use waiting
}
Stop-Here ("papan tidak menjawab dalam 20 detik (dimulai " + $began.ToString("HH:mm:ss") + "). Lihat " + $log)
