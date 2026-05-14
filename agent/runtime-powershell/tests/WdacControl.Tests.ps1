# agent/runtime-powershell/tests/WdacControl.Tests.ps1
# Pester v5

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $script:moduleRoot 'lib/WdacControl.psm1') -Force
    $script:testdataRoot = Join-Path $script:moduleRoot 'testdata'
}

Describe 'WdacControl module load' {
    It 'imports without error' {
        (Get-Module WdacControl) | Should -Not -BeNullOrEmpty
    }
}

Describe 'ConvertFrom-CodeIntegrityEvent' {
    It 'parses a 3076 (audit) event into a hashtable' {
        $xml = [xml](Get-Content (Join-Path $script:testdataRoot 'codeintegrity-3076.xml') -Raw)
        $r = ConvertFrom-CodeIntegrityEvent -EventXml $xml
        $r.event_id    | Should -Be 3076
        $r.file_path   | Should -Match 'notepad-plus-plus\.exe$'
        $r.file_name   | Should -Be 'notepad-plus-plus.exe'
        $r.file_hash   | Should -Be '112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00'
        $r.event_time  | Should -Be '2026-05-15T08:00:00Z'
        $r.is_block    | Should -Be $false
    }

    It 'parses a 3077 (block) event and sets is_block = true' {
        $xml = [xml](Get-Content (Join-Path $script:testdataRoot 'codeintegrity-3077.xml') -Raw)
        $r = ConvertFrom-CodeIntegrityEvent -EventXml $xml
        $r.event_id    | Should -Be 3077
        $r.is_block    | Should -Be $true
        $r.user_name   | Should -Be 'TEST-HOST\jdoe'
        $r.parent_process | Should -Match 'cmd\.exe$'
    }
}

Describe 'ConvertTo-CIPolicyXml' {
    It 'produces an XML with PolicyType and rule entries' {
        $rules = @(
            [pscustomobject]@{ action='allow'; rule_type='publisher'; publisher_name='CN=Microsoft Corp'; product_name=$null; value='CN=Microsoft Corp' },
            [pscustomobject]@{ action='allow'; rule_type='hash';      publisher_name=$null;              product_name=$null; value='AABBCC' }
        )
        $xml = ConvertTo-CIPolicyXml -Rules $rules -Mode 'audit' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Match '<PolicyTypeID>'
        $xml | Should -Match '<Allow ID="ID_ALLOW_0"'
        $xml | Should -Match 'CN=Microsoft Corp'
        $xml | Should -Match 'AABBCC'
    }

    It 'sets the Audit rule option when Mode is audit' {
        $xml = ConvertTo-CIPolicyXml -Rules @() -Mode 'audit' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Match 'Enabled:Audit Mode'
    }

    It 'omits the Audit rule option when Mode is enforce' {
        $xml = ConvertTo-CIPolicyXml -Rules @() -Mode 'enforce' -PolicyGuid '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'
        $xml | Should -Not -Match 'Enabled:Audit Mode'
    }
}

Describe 'WdacAgentState' {
    BeforeEach {
        $script:stateFile = Join-Path ([IO.Path]::GetTempPath()) ("wdac-state-" + [guid]::NewGuid() + ".json")
    }

    AfterEach {
        Remove-Item -Path $script:stateFile -ErrorAction SilentlyContinue
    }

    It 'returns a fresh default when file is missing' {
        $s = Get-WdacAgentState -Path $script:stateFile
        $s.last_applied_version | Should -BeNullOrEmpty
        $s.last_event_record_id | Should -Be 0
    }

    It 'round-trips a write then read' {
        Set-WdacAgentState -Path $script:stateFile -State @{
            peritus_policy_guid = '{1111-2222}'
            last_applied_version = 'abc'
            last_applied_at = '2026-05-15T00:00:00Z'
            last_event_record_id = 12345
        }
        $r = Get-WdacAgentState -Path $script:stateFile
        $r.peritus_policy_guid  | Should -Be '{1111-2222}'
        $r.last_applied_version | Should -Be 'abc'
        $r.last_event_record_id | Should -Be 12345
    }

    It 'tolerates a corrupt state file by returning default' {
        Set-Content -Path $script:stateFile -Value 'not json' -Encoding UTF8
        $s = Get-WdacAgentState -Path $script:stateFile
        $s.last_event_record_id | Should -Be 0
    }
}

Describe 'Aggregate-WdacObservations' {
    It 'collapses repeated (file_path, file_hash) into a single row with summed exec_count' {
        $records = @(
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:00:00Z'; is_block=$false; record_id=1 },
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:01:00Z'; is_block=$false; record_id=2 },
            [pscustomobject]@{ file_path='C:\b.exe'; file_hash='BB'; file_name='b.exe'; event_time='2026-05-15T01:02:00Z'; is_block=$false; record_id=3 }
        )
        $r = Aggregate-WdacObservations -Records $records
        $r.Count | Should -Be 2
        ($r | Where-Object { $_.file_path -eq 'C:\a.exe' }).exec_count | Should -Be 2
        ($r | Where-Object { $_.file_path -eq 'C:\b.exe' }).exec_count | Should -Be 1
    }

    It 'returns the max record_id across the batch' {
        $records = @(
            [pscustomobject]@{ file_path='C:\a.exe'; file_hash='AA'; file_name='a.exe'; event_time='2026-05-15T01:00:00Z'; is_block=$false; record_id=10 },
            [pscustomobject]@{ file_path='C:\b.exe'; file_hash='BB'; file_name='b.exe'; event_time='2026-05-15T01:01:00Z'; is_block=$false; record_id=20 }
        )
        $max = Get-MaxRecordId -Records $records
        $max | Should -Be 20
    }
}
