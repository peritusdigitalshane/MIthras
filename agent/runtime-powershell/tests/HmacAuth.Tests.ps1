# Pester v5 tests for HmacAuth.psm1
# Vectors are pinned to match the TypeScript reference at supabase/functions/_shared/hmac.ts

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/HmacAuth.psm1') -Force
}

Describe 'ConvertTo-CanonicalJson' {
    It 'sorts object keys lexicographically' {
        $result = ConvertTo-CanonicalJson -Value @{ b = 2; a = 1 }
        $result | Should -Be '{"a":1,"b":2}'
    }

    It 'sorts nested object keys recursively' {
        $obj = [ordered]@{ a = [ordered]@{ d = 4; c = 3 }; b = 2 }
        $result = ConvertTo-CanonicalJson -Value $obj
        $result | Should -Be '{"a":{"c":3,"d":4},"b":2}'
    }

    It 'preserves array order' {
        $result = ConvertTo-CanonicalJson -Value @(3, 1, 2)
        $result | Should -Be '[3,1,2]'
    }

    It 'handles null, true, false, numbers, strings' {
        $obj = [ordered]@{ a = $null; b = $true; c = 1.5; d = 'x' }
        $result = ConvertTo-CanonicalJson -Value $obj
        $result | Should -Be '{"a":null,"b":true,"c":1.5,"d":"x"}'
    }

    It 'escapes special characters in strings the same way as JSON.stringify' {
        $result = ConvertTo-CanonicalJson -Value @{ msg = "line1`nline2`t`"quoted`"" }
        $result | Should -Be '{"msg":"line1\nline2\t\"quoted\""}'
    }
}

Describe 'Get-HmacSignature (matches TS reference)' {
    It 'POST /x 1700000000 {} produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $sig | Should -Be '8092321aacd5e0ffccd69c7049fd0b4a901f1a7553d64cf76343fa6e5e9a2fe4'
    }

    It 'GET /agent-version-check 1700000000 (empty body) produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'GET' -Path '/agent-version-check' -Timestamp '1700000000' -RawBody ''
        $sig | Should -Be '0e288af0dd8480d457a81f4982a7a37368744e8432ff297425498e659a9c8794'
    }

    It 'POST /agent-heartbeat 1700000000 {"a":1} produces the pinned vector' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/agent-heartbeat' -Timestamp '1700000000' -RawBody '{"a":1}'
        $sig | Should -Be 'ab14daa3fb5f1a77692df95d70ab3a27d3ec1991027dc89321816b74471dab2f'
    }

    It 'uppercases the method' {
        $a = Get-HmacSignature -Secret 'secret' -Method 'post' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $b = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $a | Should -Be $b
    }

    It 'produces 64-character lowercase hex' {
        $sig = Get-HmacSignature -Secret 'secret' -Method 'POST' -Path '/x' -Timestamp '1700000000' -RawBody '{}'
        $sig.Length | Should -Be 64
        $sig | Should -Match '^[0-9a-f]{64}$'
    }

    It 'is deterministic — same input produces same output' {
        $a = Get-HmacSignature -Secret 'k' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $b = Get-HmacSignature -Secret 'k' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $a | Should -Be $b
    }

    It 'changes when any field changes' {
        $base = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffSecret = Get-HmacSignature -Secret 's2' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffMethod = Get-HmacSignature -Secret 's' -Method 'GET' -Path '/p' -Timestamp '1' -RawBody 'b'
        $diffPath = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p2' -Timestamp '1' -RawBody 'b'
        $diffTs = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '2' -RawBody 'b'
        $diffBody = Get-HmacSignature -Secret 's' -Method 'POST' -Path '/p' -Timestamp '1' -RawBody 'b2'
        @($base, $diffSecret, $diffMethod, $diffPath, $diffTs, $diffBody) | Sort-Object -Unique | Measure-Object | Select-Object -ExpandProperty Count | Should -Be 6
    }
}

Describe 'New-HmacRequestHeaders' {
    It 'returns a hashtable with the three required headers' {
        $headers = New-HmacRequestHeaders -AgentId '11111111-1111-1111-1111-111111111111' -Secret 'k' -Method 'POST' -Path '/p' -RawBody '{}'
        $headers.Keys | Should -Contain 'X-Agent-Id'
        $headers.Keys | Should -Contain 'X-Timestamp'
        $headers.Keys | Should -Contain 'X-Signature'
        $headers['X-Agent-Id'] | Should -Be '11111111-1111-1111-1111-111111111111'
        $headers['X-Signature'].Length | Should -Be 64
    }

    It 'X-Timestamp is an integer string within 60 seconds of now' {
        $headers = New-HmacRequestHeaders -AgentId 'x' -Secret 'k' -Method 'POST' -Path '/p' -RawBody '{}'
        $ts = [long]$headers['X-Timestamp']
        $now = [long](Get-Date -UFormat %s)
        [Math]::Abs($now - $ts) | Should -BeLessOrEqual 60
    }
}
