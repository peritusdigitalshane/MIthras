# Pester v5 tests for SecureConfig.psm1
# DPAPI-encrypted JSON config round-trip tests.

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/SecureConfig.psm1') -Force
}

Describe 'Save-SecureConfig / Read-SecureConfig' {
    It 'round-trips a simple object' {
        $testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
        try {
            $cfg = @{ agent_id = 'abc-123'; agent_secret = 'shhh'; api_base_url = 'https://api.example.com' }
            Save-SecureConfig -Path $testPath -Config $cfg
            $loaded = Read-SecureConfig -Path $testPath
            $loaded.agent_id      | Should -Be 'abc-123'
            $loaded.agent_secret  | Should -Be 'shhh'
            $loaded.api_base_url  | Should -Be 'https://api.example.com'
        }
        finally {
            if (Test-Path $testPath) { Remove-Item $testPath -Force }
        }
    }

    It 'writes a file that is NOT plaintext JSON' {
        $testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
        try {
            Save-SecureConfig -Path $testPath -Config @{ x = 'plaintext-value' }
            $raw = [System.IO.File]::ReadAllText($testPath)
            $raw | Should -Not -Match 'plaintext-value'
        }
        finally {
            if (Test-Path $testPath) { Remove-Item $testPath -Force }
        }
    }

    It 'overwrites cleanly when called twice' {
        $testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
        try {
            Save-SecureConfig -Path $testPath -Config @{ v = 1 }
            Save-SecureConfig -Path $testPath -Config @{ v = 2 }
            $loaded = Read-SecureConfig -Path $testPath
            $loaded.v | Should -Be 2
        }
        finally {
            if (Test-Path $testPath) { Remove-Item $testPath -Force }
        }
    }

    It 'restricts file ACL to SYSTEM and Administrators' {
        $testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
        try {
            Save-SecureConfig -Path $testPath -Config @{ x = 1 }
            $acl = Get-Acl -Path $testPath
            $identities = $acl.Access | ForEach-Object { $_.IdentityReference.Value }
            # Either SYSTEM or BUILTIN\Administrators must be present, and Users/Everyone must NOT be
            ($identities -join ' ') | Should -Match '(SYSTEM|Administrators)'
            $identities | Where-Object { $_ -match '(Users|Everyone|Authenticated Users)' } | Should -BeNullOrEmpty
        }
        finally {
            if (Test-Path $testPath) { Remove-Item $testPath -Force }
        }
    }

    It 'Read-SecureConfig throws on missing file' {
        $missing = Join-Path $env:TEMP "missing-$([Guid]::NewGuid()).dat"
        { Read-SecureConfig -Path $missing } | Should -Throw
    }
}

Describe 'Test-SecureConfigExists' {
    It 'returns false for a missing file' {
        $missing = Join-Path $env:TEMP "missing-$([Guid]::NewGuid()).dat"
        Test-SecureConfigExists -Path $missing | Should -BeFalse
    }

    It 'returns true after save' {
        $testPath = Join-Path $env:TEMP "peritus-test-config-$([Guid]::NewGuid()).dat"
        try {
            Save-SecureConfig -Path $testPath -Config @{ x = 1 }
            Test-SecureConfigExists -Path $testPath | Should -BeTrue
        }
        finally {
            if (Test-Path $testPath) { Remove-Item $testPath -Force }
        }
    }
}
