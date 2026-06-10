# mithras-tray.ps1 -- Mithras Threat Defence Agent system-tray icon.
#
# Runs in the logged-in user's session (not SYSTEM). Shows the Mithras logo
# in the notification area with a right-click menu for status / open logs /
# restart service. Reads agent state from C:\ProgramData\Mithras\logs\ and
# the MithrasAgent service.
#
# Installed by mithras-tray-install.ps1 into the per-user Startup folder so
# it autoruns on logon. Stays running until the user logs off; no NSSM
# wrapping (session-0 services cannot show tray icons).

[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Single-instance guard, per logged-in user. The install script always kills
# any existing tray before relaunching, so the mutex is held briefly free
# between kill and the new spawn -- a fresh tray takes ownership cleanly.
# Multiple SIMULTANEOUS launches (wscript races, double Shell.Run, AMSI quirks)
# are rejected here: only the first to acquire the mutex shows an icon.
$script:MutexName = 'Local\Mithras.Tray.SingleInstance'
$script:CreatedNew = $false
$script:Mutex = New-Object System.Threading.Mutex($false, $script:MutexName, [ref]$script:CreatedNew)
$acquired = $false
try { $acquired = $script:Mutex.WaitOne(250) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
if (-not $acquired) {
    try { $script:Mutex.Dispose() } catch {}
    [Environment]::Exit(0)
}

$script:InstallRoot = 'C:\ProgramData\Mithras\install'
$script:LogDir      = 'C:\ProgramData\Mithras\logs'
$script:IconPath    = Join-Path $script:InstallRoot 'mithras.ico'
$script:ServiceName = 'MithrasAgent'

if (-not (Test-Path $script:IconPath)) {
    [System.Windows.Forms.MessageBox]::Show("Mithras icon not found at $script:IconPath","Mithras Tray") | Out-Null
    return
}

$script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:NotifyIcon.Icon    = New-Object System.Drawing.Icon($script:IconPath)
$script:NotifyIcon.Text    = 'Mithras Threat Defence Agent'
$script:NotifyIcon.Visible = $true

function Get-AgentStatusText {
    $svc = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return 'Service: NOT INSTALLED' }
    $statusLine = "Service: $($svc.Status)"
    $latestLog = Get-ChildItem $script:LogDir -Filter 'agent-*.log' -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        $lastWrite = $latestLog.LastWriteTime
        $ageSec = ((Get-Date) - $lastWrite).TotalSeconds
        $statusLine += "`nLast log activity: $('{0:N0}' -f $ageSec)s ago"
    }
    $cfg = 'C:\ProgramData\Mithras\config.dat'
    if (Test-Path $cfg) { $statusLine += "`nEnrolled: yes" } else { $statusLine += "`nEnrolled: NO" }
    return $statusLine
}

function Update-TrayTooltip {
    $svc = Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue
    $statusGlyph = if ($svc -and $svc.Status -eq 'Running') { 'OK' } else { 'STOPPED' }
    # NotifyIcon.Text is capped at 63 chars; keep it terse.
    $script:NotifyIcon.Text = "Mithras [$statusGlyph]"
}

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemStatus = $menu.Items.Add('Status...')
$itemStatus.add_Click({
    [System.Windows.Forms.MessageBox]::Show(
        (Get-AgentStatusText),
        'Mithras Threat Defence Agent',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
})

$itemOpenLogs = $menu.Items.Add('Open logs folder')
$itemOpenLogs.add_Click({
    if (Test-Path $script:LogDir) {
        Start-Process 'explorer.exe' $script:LogDir
    } else {
        [System.Windows.Forms.MessageBox]::Show("Log directory not found at $script:LogDir") | Out-Null
    }
})

$itemTailLog = $menu.Items.Add('Tail latest log...')
$itemTailLog.add_Click({
    $latest = Get-ChildItem $script:LogDir -Filter 'agent-*.log' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        # Tail in a new window. UseShellExecute lets the new console own its window.
        $cmd = "Get-Content -Path '$($latest.FullName)' -Tail 50 -Wait"
        Start-Process 'powershell.exe' -ArgumentList @('-NoExit','-NoProfile','-Command', $cmd)
    } else {
        [System.Windows.Forms.MessageBox]::Show("No log file found in $script:LogDir") | Out-Null
    }
})

$menu.Items.Add('-') | Out-Null

$itemRestart = $menu.Items.Add('Restart agent service')
$itemRestart.add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Restart $($script:ServiceName)?",
        'Confirm restart',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    try {
        Start-Process 'powershell.exe' -Verb RunAs -WindowStyle Hidden `
            -ArgumentList @('-NoProfile','-Command',"Restart-Service -Name '$($script:ServiceName)' -Force")
    } catch {
        [System.Windows.Forms.MessageBox]::Show("Restart failed: $($_.Exception.Message)") | Out-Null
    }
})

$menu.Items.Add('-') | Out-Null

$itemAbout = $menu.Items.Add('About...')
$itemAbout.add_Click({
    $ver = 'unknown'
    $verFile = Join-Path $script:InstallRoot 'agent.version'
    if (Test-Path $verFile) { $ver = (Get-Content $verFile -Raw).Trim() }
    [System.Windows.Forms.MessageBox]::Show(
        "Mithras Threat Defence Agent`nv$ver`n`nInstalled at: C:\ProgramData\Mithras\`nLogs: C:\ProgramData\Mithras\logs\",
        'About Mithras',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
})

$itemExit = $menu.Items.Add('Hide tray icon (until next logon)')
$itemExit.add_Click({
    $script:NotifyIcon.Visible = $false
    $script:NotifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$script:NotifyIcon.ContextMenuStrip = $menu

# Single-click on the tray icon opens the Status dialog.
$script:NotifyIcon.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        [System.Windows.Forms.MessageBox]::Show(
            (Get-AgentStatusText),
            'Mithras Threat Defence Agent',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})

# Tooltip refresh timer -- updates "[OK]"/"[STOPPED]" suffix every 10s.
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = 10000
$script:Timer.add_Tick({ Update-TrayTooltip })
$script:Timer.Start()
Update-TrayTooltip

# Message loop. Blocks until Application.Exit() above.
[System.Windows.Forms.Application]::Run()
