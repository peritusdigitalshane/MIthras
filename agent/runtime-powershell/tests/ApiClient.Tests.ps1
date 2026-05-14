BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $script:moduleRoot 'lib/HmacAuth.psm1')  -Force
    Import-Module (Join-Path $script:moduleRoot 'lib/ApiClient.psm1') -Force
}

Describe 'Invoke-AgentAppControlObserved' {
    It 'builds HMAC headers for the /agent-app-control/observed path' {
        # We don't actually POST; we mock Invoke-RestMethod and capture args.
        Mock -CommandName Invoke-RestMethod -ModuleName ApiClient -MockWith { return @{ upserted = 1 } } -Verifiable

        $r = Invoke-AgentAppControlObserved `
            -ApiBaseUrl 'http://example.test' `
            -AgentId    'deadbeef-1111-2222-3333-444455556666' `
            -AgentSecret 'shhh' `
            -Apps       @(@{ file_path = 'C:\test.exe'; first_seen = '2026-05-15T00:00:00Z'; exec_count = 1 })

        $r.upserted | Should -Be 1
        Assert-MockCalled -CommandName Invoke-RestMethod -ModuleName ApiClient -ParameterFilter {
            $Uri -like '*/functions/v1/agent-app-control/observed' -and
            $Headers.ContainsKey('X-Signature') -and
            $Headers.ContainsKey('X-Timestamp') -and
            $Headers['X-Agent-Id'] -eq 'deadbeef-1111-2222-3333-444455556666'
        }
    }
}
