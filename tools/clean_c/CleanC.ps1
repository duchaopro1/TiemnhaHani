<#
  CleanC.ps1 - Find what is eating drive C: and (optionally) delete SAFE caches / temp files.

  DEFAULT = REPORT ONLY. Nothing is deleted unless you run with -Clean and answer "y" per category.

  Usage (open PowerShell as Administrator for best results):
    powershell -ExecutionPolicy Bypass -File .\CleanC.ps1             # report: size of each cleanable category
    powershell -ExecutionPolicy Bypass -File .\CleanC.ps1 -Big        # also list the biggest folders / files in your profile
    powershell -ExecutionPolicy Bypass -File .\CleanC.ps1 -Clean      # ask y/N per category, then delete

  Only well-known cache / temp locations are touched. Documents, Downloads, Desktop, Pictures,
  browser passwords / history / cookies, and anything in C:\Windows (except Temp, update download
  cache and crash dumps) are NEVER deleted by this script.
#>
param(
    [switch]$Clean,
    [switch]$Big,
    [int]$Top = 15
)

$ErrorActionPreference = 'SilentlyContinue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Fmt([double]$b) {
    if ($b -ge 1GB) { return ('{0:N2} GB' -f ($b / 1GB)) }
    if ($b -ge 1MB) { return ('{0:N0} MB' -f ($b / 1MB)) }
    return ('{0:N0} KB' -f ($b / 1KB))
}
function FreeC { (Get-PSDrive -Name C).Free }

# Files matched by a list of glob patterns (each glob is expanded with -Recurse so "dir\*" = everything inside dir)
function Get-Targets([string[]]$globs) {
    foreach ($g in $globs) {
        Get-ChildItem -Path $g -Force -Recurse -File -ErrorAction SilentlyContinue
    }
}
function Get-GlobSize([string[]]$globs) {
    $s = (Get-Targets $globs | Measure-Object -Property Length -Sum).Sum
    if ($null -eq $s) { return [long]0 } else { return [long]$s }
}
function Remove-Globs([string[]]$globs) {
    foreach ($g in $globs) {
        # delete files first, then empty sub-folders (the folder given in the glob itself is kept)
        Get-ChildItem -Path $g -Force -Recurse -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $g -Force -Recurse -Directory -ErrorAction SilentlyContinue |
            Sort-Object { $_.FullName.Length } -Descending |
            Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

$U  = $env:USERPROFILE
$LA = $env:LOCALAPPDATA
$RA = $env:APPDATA

# ---------------------------------------------------------------- categories
# Name, Globs, NeedsAdmin, Warn (shown before asking), Pre/Post (script blocks)
$cats = @(
    @{ Name = 'User temp files'; Admin = $false
       Globs = @("$env:TEMP\*") ; Warn = 'Files used by running programs are skipped.' },
    @{ Name = 'Windows temp (C:\Windows\Temp)'; Admin = $true
       Globs = @("$env:SystemRoot\Temp\*") ; Warn = '' },
    @{ Name = 'Windows Update download cache'; Admin = $true
       Globs = @("$env:SystemRoot\SoftwareDistribution\Download\*",
                 "$env:SystemRoot\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache\*")
       Warn = 'Windows re-downloads updates if needed. Update services are stopped briefly and restarted.'
       Pre  = { Stop-Service -Name wuauserv, bits, dosvc -Force -ErrorAction SilentlyContinue }
       Post = { Start-Service -Name wuauserv, bits, dosvc -ErrorAction SilentlyContinue } },
    @{ Name = 'Crash dumps and error reports'; Admin = $true
       Globs = @("$env:SystemRoot\Minidump\*", "$env:SystemRoot\LiveKernelReports\*", "$env:SystemRoot\MEMORY.DMP",
                 "$env:ProgramData\Microsoft\Windows\WER\ReportQueue\*", "$env:ProgramData\Microsoft\Windows\WER\ReportArchive\*",
                 "$LA\CrashDumps\*")
       Warn = 'Only needed if you are debugging a Windows blue screen.' },
    @{ Name = 'Thumbnail / icon cache'; Admin = $false
       Globs = @("$LA\Microsoft\Windows\Explorer\thumbcache_*.db", "$LA\Microsoft\Windows\Explorer\iconcache_*.db")
       Warn = 'Rebuilt automatically by Explorer.' },
    @{ Name = 'Browser caches (Chrome, Edge, Firefox)'; Admin = $false
       Globs = @("$LA\Google\Chrome\User Data\*\Cache\*", "$LA\Google\Chrome\User Data\*\Code Cache\*", "$LA\Google\Chrome\User Data\*\GPUCache\*",
                 "$LA\Microsoft\Edge\User Data\*\Cache\*",  "$LA\Microsoft\Edge\User Data\*\Code Cache\*",  "$LA\Microsoft\Edge\User Data\*\GPUCache\*",
                 "$LA\Mozilla\Firefox\Profiles\*\cache2\*")
       Warn = 'CLOSE the browsers first. Only caches: passwords, history, cookies and logins are kept.' },
    @{ Name = 'VS Code caches'; Admin = $false
       Globs = @("$RA\Code\Cache\*", "$RA\Code\CachedData\*", "$RA\Code\CachedExtensionVSIXs\*", "$RA\Code\Code Cache\*", "$RA\Code\GPUCache\*")
       Warn = 'Rebuilt on next start. Settings and extensions are kept.' },
    @{ Name = 'Developer package caches (npm, pip, NuGet, yarn)'; Admin = $false
       Globs = @("$LA\npm-cache\*", "$LA\pip\Cache\*", "$LA\NuGet\v3-cache\*", "$LA\Yarn\Cache\*")
       Warn = 'Packages are downloaded again when a project needs them.' },
    @{ Name = 'Gradle cache (~\.gradle\caches)'; Admin = $false
       Globs = @("$U\.gradle\caches\*")
       Warn = 'Can be several GB. Next Gradle build re-downloads dependencies (slow, needs internet).' }
)

# ---------------------------------------------------------------- header
$free0 = FreeC
Write-Host ''
Write-Host '=== CleanC: disk C: space report ===' -ForegroundColor Cyan
Write-Host ('Free on C: {0}   (admin: {1})' -f (Fmt $free0), $isAdmin)
if (-not $isAdmin) { Write-Host 'Tip: run PowerShell as Administrator to include and clean system locations.' -ForegroundColor Yellow }
if ($Clean) {
    foreach ($p in 'chrome', 'msedge', 'firefox', 'Code') {
        if (Get-Process -Name $p -ErrorAction SilentlyContinue) {
            Write-Host "Warning: '$p' is running - its cache cannot be fully cleaned. Close it for best result." -ForegroundColor Yellow
        }
    }
}
Write-Host ''
Write-Host 'Scanning cleanable categories (can take a minute)...'

# ---------------------------------------------------------------- report
$rows = @()
foreach ($c in $cats) {
    $size = Get-GlobSize $c.Globs
    $c.Size = $size
    $rows += [pscustomobject]@{ Category = $c.Name; Size = (Fmt $size); NeedsAdmin = $(if ($c.Admin) { 'yes' } else { '' }); Bytes = $size }
}
# Recycle Bin (size via shell, per drive)
$rbSize = 0
$rbCount = 0
try {
    $shell = New-Object -ComObject Shell.Application
    $rb = $shell.NameSpace(0xA)
    foreach ($i in $rb.Items()) { $rbCount++; $rbSize += [long]$i.ExtendedProperty('System.Size') }
} catch { }
$rows += [pscustomobject]@{ Category = 'Recycle Bin'; Size = (Fmt $rbSize); NeedsAdmin = ''; Bytes = $rbSize }

$rows | Sort-Object Bytes -Descending | Format-Table Category, Size, NeedsAdmin -AutoSize
$total = ($rows | Measure-Object -Property Bytes -Sum).Sum
Write-Host ('Total that can usually be reclaimed: {0}' -f (Fmt $total)) -ForegroundColor Green

# ---------------------------------------------------------------- things to check by hand (never auto-deleted)
Write-Host ''
Write-Host '--- Big items this script will NOT delete (check by hand) ---' -ForegroundColor Cyan
$hib = Get-Item -LiteralPath "$env:SystemDrive\hiberfil.sys" -Force -ErrorAction SilentlyContinue
if ($hib) { Write-Host ('hiberfil.sys (hibernation file)  {0}  -> "powercfg -h off" (admin) frees it; you lose hibernate / fast startup' -f (Fmt $hib.Length)) }
$pf = Get-Item -LiteralPath "$env:SystemDrive\pagefile.sys" -Force -ErrorAction SilentlyContinue
if ($pf) { Write-Host ('pagefile.sys (virtual memory)    {0}  -> can be moved to D: in System > Advanced > Performance > Advanced > Virtual memory' -f (Fmt $pf.Length)) }
$wo = "$env:SystemDrive\Windows.old"
if (Test-Path -LiteralPath $wo) { Write-Host 'Windows.old exists (old Windows install, often 10-30 GB) -> remove via Settings > System > Storage > Temporary files > "Previous Windows installation(s)"' }
Write-Host 'System Restore snapshots: run  vssadmin list shadowstorage  (admin) and shrink with  vssadmin resize shadowstorage /for=C: /on=C: /maxsize=5GB'
Write-Host 'Also check: WSL / Docker disk images (*.vhdx), Android Studio / SDK, INCA / ETAS measurement data (.dat, .mdf), Downloads, Videos, old installers.'

# ---------------------------------------------------------------- big folders / files
if ($Big) {
    Write-Host ''
    Write-Host ('--- Biggest folders directly under {0} ---' -f $U) -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $U -Force -Directory | ForEach-Object {
        $s = (Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        [pscustomobject]@{ Folder = $_.FullName; Bytes = [long]$s; Size = (Fmt $s) }
    } | Sort-Object Bytes -Descending | Select-Object -First $Top | Format-Table Folder, Size -AutoSize

    Write-Host ('--- Biggest folders inside {0} ---' -f "$LA") -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $LA -Force -Directory | ForEach-Object {
        $s = (Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        [pscustomobject]@{ Folder = $_.FullName; Bytes = [long]$s; Size = (Fmt $s) }
    } | Sort-Object Bytes -Descending | Select-Object -First $Top | Format-Table Folder, Size -AutoSize

    Write-Host ('--- {0} biggest files in your profile (this can take several minutes) ---' -f $Top) -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $U -Recurse -Force -File -ErrorAction SilentlyContinue |
        Sort-Object Length -Descending | Select-Object -First $Top |
        Select-Object @{ n = 'Size'; e = { Fmt $_.Length } }, FullName | Format-Table -AutoSize
}

# ---------------------------------------------------------------- clean
if (-not $Clean) {
    Write-Host ''
    Write-Host 'Report only - nothing was deleted. Run again with -Clean to free space.' -ForegroundColor Yellow
    return
}

Write-Host ''
Write-Host '=== Cleaning: answer y to delete, anything else to skip ===' -ForegroundColor Cyan
foreach ($c in ($cats | Sort-Object { $_.Size } -Descending)) {
    if ($c.Size -le 0) { continue }
    if ($c.Admin -and -not $isAdmin) { Write-Host ("Skip '{0}' ({1}): needs Administrator." -f $c.Name, (Fmt $c.Size)) -ForegroundColor Yellow; continue }
    Write-Host ''
    Write-Host ('{0}: {1}' -f $c.Name, (Fmt $c.Size)) -ForegroundColor White
    if ($c.Warn) { Write-Host ('  ' + $c.Warn) -ForegroundColor DarkYellow }
    if ((Read-Host '  Delete? [y/N]') -ne 'y') { continue }
    $before = FreeC
    if ($c.Pre) { & $c.Pre }
    Remove-Globs $c.Globs
    if ($c.Post) { & $c.Post }
    Write-Host ('  freed {0}' -f (Fmt ([math]::Max(0, (FreeC) - $before)))) -ForegroundColor Green
}
if ($rbCount -gt 0) {
    Write-Host ''
    Write-Host ('Recycle Bin: {0} item(s), {1}' -f $rbCount, (Fmt $rbSize)) -ForegroundColor White
    Write-Host '  Files in the Recycle Bin are permanently deleted.' -ForegroundColor DarkYellow
    if ((Read-Host '  Empty it? [y/N]') -eq 'y') { Clear-RecycleBin -Force -ErrorAction SilentlyContinue }
}

$free1 = FreeC
Write-Host ''
Write-Host ('Free on C: before {0}  ->  after {1}   (+{2})' -f (Fmt $free0), (Fmt $free1), (Fmt ([math]::Max(0, $free1 - $free0)))) -ForegroundColor Cyan
