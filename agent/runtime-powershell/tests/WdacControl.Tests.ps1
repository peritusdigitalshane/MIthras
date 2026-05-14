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
