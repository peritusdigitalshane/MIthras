function Get-WindowsUpdateStatus {
    try {
        Write-Log "Collecting Windows Update status..."
        $wuPolicies = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
        $wuAU = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
        
        $status = @{
            wu_auto_update_mode = $null
            wu_active_hours_start = $null
            wu_active_hours_end = $null
            wu_feature_update_deferral = $null
            wu_quality_update_deferral = $null
            wu_pause_feature_updates = $null
            wu_pause_quality_updates = $null
            wu_pending_updates_count = $null
            wu_last_install_date = $null
            wu_restart_pending = $null
        }
        
        if (Test-Path $wuAU) {
            $au = Get-ItemProperty -Path $wuAU -ErrorAction SilentlyContinue
            if ($null -ne $au.AUOptions) { $status.wu_auto_update_mode = $au.AUOptions }
        }
        
        if (Test-Path $wuPolicies) {
            $wu = Get-ItemProperty -Path $wuPolicies -ErrorAction SilentlyContinue
            if ($null -ne $wu.ActiveHoursStart) { $status.wu_active_hours_start = $wu.ActiveHoursStart }
            if ($null -ne $wu.ActiveHoursEnd) { $status.wu_active_hours_end = $wu.ActiveHoursEnd }
            if ($null -ne $wu.DeferFeatureUpdates) { $status.wu_feature_update_deferral = $wu.DeferFeatureUpdatesPeriodInDays }
            if ($null -ne $wu.DeferQualityUpdates) { $status.wu_quality_update_deferral = $wu.DeferQualityUpdatesPeriodInDays }
            if ($null -ne $wu.PauseFeatureUpdatesStartTime) { $status.wu_pause_feature_updates = $true }
            if ($null -ne $wu.PauseQualityUpdatesStartTime) { $status.wu_pause_quality_updates = $true }
        }
        
        try {
            $updateSession = New-Object -ComObject Microsoft.Update.Session
            $updateSearcher = $updateSession.CreateUpdateSearcher()
            $searchResult = $updateSearcher.Search("IsInstalled=0 and Type='Software'")
            $status.wu_pending_updates_count = $searchResult.Updates.Count
        } catch { Write-Log "Could not query pending updates: $_" -Level "WARN" }
        
        try {
            $lastInstall = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WindowsUpdateClient'; Id=19} -MaxEvents 1 -ErrorAction SilentlyContinue
            if ($lastInstall) { $status.wu_last_install_date = $lastInstall.TimeCreated.ToUniversalTime().ToString("o") }
        } catch { }
        
        $pendingRestart = $false
        $rebootPaths = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"
        )
        foreach ($path in $rebootPaths) {
            if (Test-Path $path) { $pendingRestart = $true; break }
        }
        $status.wu_restart_pending = $pendingRestart
        
        return $status
    } catch {
        Write-Log "Error getting Windows Update status: $_" -Level "ERROR"
        return @{}
    }
}
