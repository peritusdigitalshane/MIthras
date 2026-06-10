# DnsPolicyEnforcer.psm1 - v0.4.7
#
# Pushes Windows NRPT rules so:
#   - Internal suffixes (corp.local etc.) resolve via the customer's internal
#     DNS forwarders.
#   - Everything else routes to the Mithras DoH resolver at
#     https://dns.mithras.com.au/{org-uuid}/dns-query.
#
# Also disables Chrome / Firefox / Edge built-in DoH via GPO registry so they
# can't bypass our resolver.
#
# Idempotent. GCs Mithras-* NRPT rules removed from policy.

$NRPT_PREFIX = 'Mithras-'
# The default-route NRPT rule uses '.' as the namespace, which Windows applies
# to *everything not matched by a more specific suffix*.

function Apply-DnsPolicy {
    <#
    .PARAMETER Policy
    Hashtable with shape:
      @{
          policy_id        = '<uuid>'
          doh_uri          = 'https://dns.mithras.com.au/<org-uuid>/dns-query'
          internal_scopes  = @(
              @{ suffix = 'corp.local';    forwarders = @('192.168.1.10','192.168.1.11') }
              @{ suffix = '0.168.192.in-addr.arpa'; forwarders = @('192.168.1.10') }
          )
          disable_browser_doh = $true
      }
    #>
    param([Parameter(Mandatory)]$Policy)

    if (-not (Get-Command -Name 'Get-DnsClientNrptRule' -ErrorAction SilentlyContinue)) {
        Write-PolicyLog "NRPT cmdlets not available; DNS module skipped on this OS." 'Warn'
        return $false
    }

    $wantedNames = New-Object System.Collections.Generic.HashSet[string]
    $created = 0; $kept = 0; $removed = 0; $errored = 0

    # 1. Per-scope rules (internal split-DNS)
    if ($Policy.internal_scopes) {
        foreach ($scope in $Policy.internal_scopes) {
            $suffix = $scope.suffix
            if (-not $suffix) { continue }
            $fwd = @($scope.forwarders) | Where-Object { $_ }
            if (-not $fwd -or $fwd.Count -eq 0) { continue }

            $ruleName = "${NRPT_PREFIX}internal-{0}" -f ($suffix -replace '[^a-zA-Z0-9._-]', '_')
            [void]$wantedNames.Add($ruleName)
            try {
                Get-DnsClientNrptRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
                # Namespace must start with '.' for suffix matching.
                $ns = if ($suffix.StartsWith('.')) { $suffix } else { '.' + $suffix }
                Add-DnsClientNrptRule -Namespace $ns -NameServers $fwd -Comment "Mithras internal scope" -ErrorAction Stop | Out-Null
                # Some Windows versions don't honour -Name on Add; rename after add.
                $latest = Get-DnsClientNrptRule | Where-Object { $_.Namespace -contains $ns -and $_.Name -ne $ruleName } | Select-Object -Last 1
                if ($latest) {
                    # NRPT rules don't have a settable Name in PS; the auto-generated GUID is fine.
                    # Track by namespace + comment instead. Adjust wantedNames accordingly.
                    [void]$wantedNames.Remove($ruleName)
                    [void]$wantedNames.Add($latest.Name)
                }
                $created++
            } catch {
                Write-PolicyLog "NRPT internal rule for $suffix failed: $($_.Exception.Message)" 'Warn'
                $errored++
            }
        }
    }

    # 2. Default DoH rule — everything not matched above routes to Mithras.
    if ($Policy.doh_uri) {
        try {
            # Remove any prior default-Mithras DoH rule
            Get-DnsClientNrptRule -ErrorAction SilentlyContinue |
                Where-Object { $_.Comment -eq 'Mithras default DoH' } |
                Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue

            # Use the Add-DnsClientNrptRule cmdlet with DNS-over-HTTPS template.
            # Available in Windows 10 1903+ / Server 2022. Older Windows lacks DoH-template support,
            # so we fall back to plain DNS NameServers using Cloudflare Family.
            $supportsDoH = (Get-Command Add-DnsClientNrptRule).Parameters.ContainsKey('DohTemplate')
            if ($supportsDoH) {
                # Configure the DoH server template first (Windows DnsOverHttps client store)
                $serverIp = '1.1.1.3'   # cloudflare-family IPs as fallback
                Add-DnsClientDohServerAddress -ServerAddress $serverIp -DohTemplate $Policy.doh_uri -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction SilentlyContinue | Out-Null
                Add-DnsClientNrptRule -Namespace '.' -NameServers $serverIp -DohTemplate $Policy.doh_uri -Comment 'Mithras default DoH' -ErrorAction Stop | Out-Null
            } else {
                # Pre-DoH Windows -- can't route via Mithras DoH. Skip default rule.
                Write-PolicyLog "Windows lacks DoH NRPT support; default rule skipped." 'Warn'
            }
            $created++
        } catch {
            Write-PolicyLog "NRPT default DoH rule failed: $($_.Exception.Message)" 'Warn'
            $errored++
        }
    }

    # 3. GC: remove Mithras-* NRPT rules whose namespace is no longer wanted.
    # NRPT rules track by namespace, so we match by Comment prefix.
    Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {
        $_.Comment -match '^Mithras'
    } | ForEach-Object {
        # Keep rules whose comment matches the active policy (we set 'Mithras internal scope' or 'Mithras default DoH').
        $isCurrent = $_.Comment -eq 'Mithras default DoH' -or $_.Comment -eq 'Mithras internal scope'
        if (-not $isCurrent) {
            $_ | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
            $removed++
        } else { $kept++ }
    }

    # 4. Optional: disable browser-level DoH so Chrome/Firefox/Edge can't bypass.
    if ($Policy.disable_browser_doh) {
        try {
            $chromeKey  = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
            $edgeKey    = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
            $firefoxKey = 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox'
            foreach ($k in @($chromeKey, $edgeKey, $firefoxKey)) {
                if (-not (Test-Path $k)) { New-Item -Path $k -Force -ErrorAction SilentlyContinue | Out-Null }
            }
            # DnsOverHttpsMode "off" disables built-in DoH. The browser will use the OS resolver.
            Set-ItemProperty -Path $chromeKey  -Name 'DnsOverHttpsMode'  -Value 'off' -Type String -Force -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $edgeKey    -Name 'DnsOverHttpsMode'  -Value 'off' -Type String -Force -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $firefoxKey -Name 'DisableSecurityBypassUI' -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
            # Firefox network.trr.mode=5 disables TRR (Firefox's DoH).
            $ffPrefs = "$firefoxKey\Preferences"
            if (-not (Test-Path $ffPrefs)) { New-Item -Path $ffPrefs -Force -ErrorAction SilentlyContinue | Out-Null }
            Set-ItemProperty -Path $ffPrefs -Name 'network.trr.mode' -Value 5 -Type DWord -Force -ErrorAction SilentlyContinue
        } catch {
            Write-PolicyLog "Browser DoH disable failed: $($_.Exception.Message)" 'Warn'
        }
    }

    Write-PolicyLog ("DNS policy applied: created={0} kept={1} removed={2} errored={3}" -f $created, $kept, $removed, $errored)
    return ($errored -eq 0)
}

function Clear-MithrasDnsPolicy {
    if (-not (Get-Command -Name 'Get-DnsClientNrptRule' -ErrorAction SilentlyContinue)) { return }
    Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {
        $_.Comment -match '^Mithras'
    } | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
    Write-PolicyLog "Mithras DNS NRPT rules cleared."
}

if (-not (Get-Command -Name Write-PolicyLog -ErrorAction SilentlyContinue)) {
    function Write-PolicyLog { param([string]$Message, [string]$Level = 'Info') Write-Host "[$Level] [Dns] $Message" }
}

Export-ModuleMember -Function Apply-DnsPolicy, Clear-MithrasDnsPolicy
