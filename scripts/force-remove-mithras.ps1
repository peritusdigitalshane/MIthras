#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Nuclear cleanup for a tamper-protected Mithras Threat Defence install
    that the normal uninstall can't budge.

.DESCRIPTION
    The agent's Tamper Protection module sets up three locks:
      1. A scheduled task ("MithrasWatchdog" or similar) that re-spawns
         the service if it sees it stopped.
      2. A hardened service DACL that blocks sc.exe stop / delete even
         from Administrator (registry: HKLM\SYSTEM\CurrentControlSet\
         Services\MithrasAgent\Security).
      3. DENY ACEs on the install dir + state files so Remove-Item fails.

    Sequence here:
      1. Disable + delete the watchdog scheduled task FIRST so it can't
         resurrect the service mid-cleanup.
      2. Kill straggler processes.
      3. Delete the Security registry value (resets service DACL to default).
      4. sc.exe stop + delete MithrasAgent.
      5. takeown + icacls reset on the install tree.
      6. Remove-Item.

    Save this file, then in elevated PowerShell:
        powershell -ExecutionPolicy Bypass -File force-remove-mithras.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=== Mithras Threat Defence -- nuclear cleanup ===" -ForegroundColor Cyan

# --- 1. Disable + delete the watchdog scheduled task ---
Write-Host "`n[1/7] Disabling watchdog scheduled task..." -ForegroundColor Yellow
foreach ($name in 'MithrasWatchdog','MithrasAgentWatchdog','PeritusSecureWatchdog','MithrasAgent','MithrasTray') {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "  removed task: $name" -ForegroundColor Green
    }
}

# --- 2. Kill straggler agent + tray + watchdog processes ---
Write-Host "`n[2/7] Killing straggler processes..." -ForegroundColor Yellow
$myPid = $PID
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='MithrasAgent.exe' OR Name='MithrasTray.exe' OR Name='Sysmon64.exe'" |
    Where-Object {
        $_.ProcessId -ne $myPid -and (
            $_.CommandLine -like "*mithras-agent*" -or
            $_.CommandLine -like "*mithras-tray*" -or
            $_.CommandLine -like "*Mithras\watchdog*" -or
            $_.CommandLine -like "*ProgramData\Mithras*" -or
            $_.Name -eq 'MithrasAgent.exe' -or
            $_.Name -eq 'MithrasTray.exe'
        )
    } | ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            Write-Host "  killed PID $($_.ProcessId) ($($_.Name))" -ForegroundColor Green
        } catch {}
    }
Start-Sleep -Seconds 1

# --- 3. Reset the service DACL via the registry ---
Write-Host "`n[3/7] Resetting MithrasAgent service DACL via registry..." -ForegroundColor Yellow
$svcKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\MithrasAgent'
if (Test-Path $svcKey) {
    # Take ownership of the service registry key so we can edit it. The
    # service DACL lives in the Security subkey as a REG_BINARY value;
    # deleting it forces Windows to fall back to the default (SYSTEM + Admin).
    $regKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(
        'SYSTEM\CurrentControlSet\Services\MithrasAgent',
        [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
        [System.Security.AccessControl.RegistryRights]::TakeOwnership
    )
    if ($regKey) {
        $admins = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
        $acl = $regKey.GetAccessControl()
        $acl.SetOwner($admins)
        $regKey.SetAccessControl($acl)
        $regKey.Close()

        # Grant Administrators full control over the key + subkeys.
        $regKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(
            'SYSTEM\CurrentControlSet\Services\MithrasAgent',
            [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
            [System.Security.AccessControl.RegistryRights]::ChangePermissions
        )
        if ($regKey) {
            $acl = $regKey.GetAccessControl()
            $rule = New-Object System.Security.AccessControl.RegistryAccessRule(
                $admins,
                [System.Security.AccessControl.RegistryRights]::FullControl,
                [System.Security.AccessControl.InheritanceFlags]::"ContainerInherit",
                [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
            $acl.AddAccessRule($rule)
            $regKey.SetAccessControl($acl)
            $regKey.Close()
        }

        # Nuke the Security subkey -> service DACL resets to default.
        Remove-Item -Path "$svcKey\Security" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  service DACL reset" -ForegroundColor Green
    }
}

# --- 4. Stop + delete the service ---
Write-Host "`n[4/7] Stopping + deleting MithrasAgent service..." -ForegroundColor Yellow
& sc.exe stop MithrasAgent 2>&1 | Out-Null
Start-Sleep -Seconds 2
& sc.exe delete MithrasAgent 2>&1 | Out-Null
Start-Sleep -Seconds 1
if (-not (Get-Service -Name MithrasAgent -ErrorAction SilentlyContinue)) {
    Write-Host "  service gone" -ForegroundColor Green
} else {
    Write-Host "  WARNING: service still present, may need reboot" -ForegroundColor Yellow
}

# --- 5. Take ownership of install tree ---
Write-Host "`n[5/7] Taking ownership of C:\ProgramData\Mithras..." -ForegroundColor Yellow
& takeown.exe /F 'C:\ProgramData\Mithras' /R /D Y 2>&1 | Out-Null
& takeown.exe /F 'C:\ProgramData\PeritusSecure' /R /D Y 2>&1 | Out-Null
Write-Host "  ownership taken" -ForegroundColor Green

# --- 6. Reset + grant ACLs (in this ORDER -- reset must come AFTER takeown) ---
Write-Host "`n[6/7] Resetting ACLs on install tree..." -ForegroundColor Yellow
& icacls.exe 'C:\ProgramData\Mithras' /reset /T /C /Q 2>&1 | Out-Null
& icacls.exe 'C:\ProgramData\Mithras' /grant 'Administrators:(OI)(CI)F' /T /C /Q 2>&1 | Out-Null
& icacls.exe 'C:\ProgramData\PeritusSecure' /reset /T /C /Q 2>&1 | Out-Null
& icacls.exe 'C:\ProgramData\PeritusSecure' /grant 'Administrators:(OI)(CI)F' /T /C /Q 2>&1 | Out-Null
Write-Host "  ACLs reset" -ForegroundColor Green

# --- 7. Remove the install dir ---
Write-Host "`n[7/7] Removing install directories..." -ForegroundColor Yellow
foreach ($path in 'C:\ProgramData\Mithras','C:\ProgramData\PeritusSecure') {
    if (Test-Path $path) {
        try {
            Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
            Write-Host "  removed: $path" -ForegroundColor Green
        } catch {
            # Last-ditch: schedule for delete-at-reboot
            Write-Host "  WARNING: could not delete $path, scheduling for next reboot" -ForegroundColor Yellow
            Write-Host "  $($_.Exception.Message)" -ForegroundColor Gray
            $stash = "$path.old.$([Guid]::NewGuid().ToString('N').Substring(0,8))"
            Move-Item $path $stash -Force -ErrorAction SilentlyContinue
            $pending = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' 'PendingFileRenameOperations' -ErrorAction SilentlyContinue).PendingFileRenameOperations
            if (-not $pending) { $pending = @() }
            Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' 'PendingFileRenameOperations' `
                -Value (@($pending) + @("\??\$stash", "")) -Type MultiString -ErrorAction SilentlyContinue
            Write-Host "  scheduled deletion of $stash at next reboot" -ForegroundColor Yellow
        }
    }
}

# --- Summary ---
Write-Host "`n=== Cleanup complete ===" -ForegroundColor Cyan
Write-Host "Run the installer again -- it should now go through."
Write-Host ""
$leftover = Test-Path 'C:\ProgramData\Mithras'
if ($leftover) {
    Write-Host "NOTE: some files were locked. They're scheduled for delete-at-reboot." -ForegroundColor Yellow
    Write-Host "You can install on top right now, or reboot first for a fully clean slate." -ForegroundColor Yellow
}
