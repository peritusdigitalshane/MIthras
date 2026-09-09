# Pester v5 tests for Updater.psm1's download-host allowlist.
#
# The download URL for an agent bundle arrives inside a server-issued
# upgrade_agent command. Test-BundleUrlAllowed is what stops a single forged
# or compromised command row from pointing the fleet at an arbitrary host.
#
# The signature check in CodeSigning.psm1 is the primary control; this is
# defence in depth, and it is the one that must not be fooled by a
# lookalike hostname.

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/CodeSigning.psm1') -Force
    Import-Module (Join-Path $moduleRoot 'lib/Updater.psm1') -Force
}

Describe 'Test-BundleUrlAllowed' {
    Context 'accepts the real bundle hosts' {
        It 'accepts the production API host' {
            Test-BundleUrlAllowed -Url 'https://api.mithras.com.au/storage/v1/object/public/agent-bundles/mithras-agent-0.7.21.zip' | Should -BeTrue
        }
        It 'accepts the Supabase storage host' {
            Test-BundleUrlAllowed -Url 'https://njdcyjxgtckgtzgzoctw.supabase.co/storage/v1/object/public/agent-bundles/x.zip' | Should -BeTrue
        }
        It 'accepts the dev API host' {
            Test-BundleUrlAllowed -Url 'https://apidev.peritusdigital.com.au/agent.zip' | Should -BeTrue
        }
    }

    Context 'rejects lookalike and hostile hosts' {
        It 'rejects a suffixed lookalike domain' {
            # The classic substring-match bug. Must be compared on parsed host.
            Test-BundleUrlAllowed -Url 'https://api.mithras.com.au.evil.tld/agent.zip' | Should -BeFalse
        }
        It 'rejects a prefixed lookalike domain' {
            Test-BundleUrlAllowed -Url 'https://evil-api.mithras.com.au.attacker.net/agent.zip' | Should -BeFalse
        }
        It 'rejects the allowed host embedded in the path' {
            Test-BundleUrlAllowed -Url 'https://evil.tld/api.mithras.com.au/agent.zip' | Should -BeFalse
        }
        It 'rejects the allowed host embedded in a query string' {
            Test-BundleUrlAllowed -Url 'https://evil.tld/x.zip?h=api.mithras.com.au' | Should -BeFalse
        }
        It 'rejects the allowed host in userinfo' {
            # https://api.mithras.com.au@evil.tld/ actually resolves to evil.tld
            Test-BundleUrlAllowed -Url 'https://api.mithras.com.au@evil.tld/agent.zip' | Should -BeFalse
        }
        It 'rejects an unrelated host' {
            Test-BundleUrlAllowed -Url 'https://example.com/agent.zip' | Should -BeFalse
        }
    }

    Context 'rejects non-HTTPS and malformed input' {
        It 'rejects plain HTTP even on an allowed host' {
            Test-BundleUrlAllowed -Url 'http://api.mithras.com.au/agent.zip' | Should -BeFalse
        }
        It 'rejects a file:// URL' {
            Test-BundleUrlAllowed -Url 'file:///C:/temp/evil.zip' | Should -BeFalse
        }
        It 'rejects a UNC path' {
            Test-BundleUrlAllowed -Url '\\attacker\share\evil.zip' | Should -BeFalse
        }
        It 'rejects an empty string' {
            Test-BundleUrlAllowed -Url '' | Should -BeFalse
        }
        It 'rejects garbage' {
            Test-BundleUrlAllowed -Url 'not a url at all' | Should -BeFalse
        }
    }
}

Describe 'Invoke-AgentSelfUpdate — refuses before downloading' {
    It 'throws on a non-allowlisted host without attempting a download' {
        # If the host check ran after the download, this would time out
        # against a non-existent host instead of throwing immediately.
        {
            Invoke-AgentSelfUpdate -DownloadUrl 'https://evil.tld/agent.zip' `
                                   -ExpectedSha256 ('0' * 64) `
                                   -Ed25519Signature 'AAAA' `
                                   -TargetVersion '9.9.9' `
                                   -AgentRoot ([System.IO.Path]::GetTempPath())
        } | Should -Throw -ExpectedMessage '*untrusted host*'
    }

    It 'requires the Ed25519Signature parameter to be supplied' {
        # Mandatory means an omitted signature is a binding error, not a
        # silent unsigned install. AllowEmptyString covers the ''-supplied
        # case, which Test-AgentBundleSignature then refuses by reason.
        (Get-Command Invoke-AgentSelfUpdate).Parameters['Ed25519Signature'].Attributes |
            Where-Object { $_ -is [System.Management.Automation.ParameterAttribute] } |
            ForEach-Object { $_.Mandatory } | Should -Contain $true
    }
}
