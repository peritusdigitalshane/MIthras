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
