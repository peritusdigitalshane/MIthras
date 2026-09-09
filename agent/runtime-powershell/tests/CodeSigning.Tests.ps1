# Pester v5 tests for CodeSigning.psm1 — the Ed25519 verifier that gates the
# agent self-update path.
#
# This is the control that stands between a compromised agent_versions row and
# SYSTEM-level code execution across the whole managed fleet. Treat a failure
# here as release-blocking, never as flaky.
#
# Coverage:
#   1. RFC 8032 section 7.1 test vectors — proves the curve maths is correct
#      against the spec's own known-answer tests, not just self-consistent.
#   2. Tamper cases — wrong signature / message / key must all be rejected.
#   3. Malformed input — must return $false, never throw, and never pass.
#   4. Signature malleability — unreduced S (>= L) must be rejected.
#   5. End-to-end bundle verification against a pinned test keypair.

BeforeAll {
    $script:moduleRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $moduleRoot 'lib/CodeSigning.psm1') -Force

    function script:Hex([string]$h) {
        if ($h.Length -eq 0) { return , (New-Object byte[] 0) }
        $b = New-Object byte[] ($h.Length / 2)
        for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }
        return , $b
    }

    # RFC 8032 s7.1
    $script:V1 = @{
        Pub = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
        Msg = ''
        Sig = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
    }
    $script:V2 = @{
        Pub = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'
        Msg = '72'
        Sig = '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'
    }
    $script:V3 = @{
        Pub = 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025'
        Msg = 'af82'
        Sig = '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'
    }

    # Pinned bundle fixture. Regenerate with:
    #   seed = utf8("MithrasAgentTestKey-DoNotUse!!!!")   (exactly 32 bytes)
    #   content = "PK mithras test bundle payload v1"     (no trailing newline)
    #   sig = Ed25519(seed).sign(sha256(content))         (raw 32-byte digest)
    $script:TestPub     = 'e18bf72f3ab69174cf6ccb4e7fc597e1e1b8859d5e22ea911c8404b0c618d4f2'
    $script:TestContent = 'PK mithras test bundle payload v1'
    $script:TestSha     = '483f498e96df67b7ca6b8c3579eaa52eb0433554289d02090faf6af2f56c95dd'
    $script:TestSigB64  = 'xKeuDKTmySNKKGVnODsR/dp96imi6z1lQRdu75KGPExT0z+N663E9vCitau4WAQ+DnDwKLmG3GhVPY9jvIp1CQ=='
}

Describe 'Test-Ed25519Signature — RFC 8032 known-answer vectors' {
    It 'verifies vector 1 (empty message)' {
        Test-Ed25519Signature -Message (Hex $V1.Msg) -Signature (Hex $V1.Sig) -PublicKey (Hex $V1.Pub) | Should -BeTrue
    }
    It 'verifies vector 2 (one-byte message)' {
        Test-Ed25519Signature -Message (Hex $V2.Msg) -Signature (Hex $V2.Sig) -PublicKey (Hex $V2.Pub) | Should -BeTrue
    }
    It 'verifies vector 3 (two-byte message)' {
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (Hex $V3.Sig) -PublicKey (Hex $V3.Pub) | Should -BeTrue
    }
}

Describe 'Test-Ed25519Signature — rejection cases' {
    It 'rejects a signature with a single flipped bit' {
        $bad = Hex $V3.Sig
        $bad[10] = $bad[10] -bxor 1
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature $bad -PublicKey (Hex $V3.Pub) | Should -BeFalse
    }
    It 'rejects a valid signature over a different message' {
        Test-Ed25519Signature -Message (Hex 'af83') -Signature (Hex $V3.Sig) -PublicKey (Hex $V3.Pub) | Should -BeFalse
    }
    It 'rejects a valid signature under a different public key' {
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (Hex $V3.Sig) -PublicKey (Hex $V2.Pub) | Should -BeFalse
    }
    It 'rejects a truncated signature' {
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (Hex ($V3.Sig.Substring(0, 100))) -PublicKey (Hex $V3.Pub) | Should -BeFalse
    }
    It 'rejects a wrong-length public key' {
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (Hex $V3.Sig) -PublicKey (Hex ($V3.Pub.Substring(0, 60))) | Should -BeFalse
    }
    It 'rejects an all-zero signature' {
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (New-Object byte[] 64) -PublicKey (Hex $V3.Pub) | Should -BeFalse
    }
    It 'rejects a public key that is not a curve point' {
        $notAPoint = New-Object byte[] 32
        for ($i = 0; $i -lt 32; $i++) { $notAPoint[$i] = 0xFF }
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature (Hex $V3.Sig) -PublicKey $notAPoint | Should -BeFalse
    }
    It 'rejects an unreduced S (signature malleability, S >= L)' {
        # Take the valid signature and set S to all 0xFF, which is far above L.
        $mal = Hex $V3.Sig
        for ($i = 32; $i -lt 64; $i++) { $mal[$i] = 0xFF }
        Test-Ed25519Signature -Message (Hex $V3.Msg) -Signature $mal -PublicKey (Hex $V3.Pub) | Should -BeFalse
    }
    It 'returns false rather than throwing on garbage input' {
        { Test-Ed25519Signature -Message (Hex 'aa') -Signature (Hex 'bb') -PublicKey (Hex 'cc') } | Should -Not -Throw
        Test-Ed25519Signature -Message (Hex 'aa') -Signature (Hex 'bb') -PublicKey (Hex 'cc') | Should -BeFalse
    }
}

Describe 'Get-MithrasReleaseSigningKey' {
    It 'returns exactly 32 bytes' {
        (Get-MithrasReleaseSigningKey).Length | Should -Be 32
    }
    It 'matches the committed agent-signing-public.pem' {
        # The PEM is a 44-byte SPKI: 12-byte Ed25519 header + the raw 32-byte key.
        $pemPath = Join-Path (Split-Path -Parent $moduleRoot) 'contracts/agent-signing-public.pem'
        $pem = (Get-Content -Raw -LiteralPath $pemPath) -replace '-----[A-Z ]+-----', '' -replace '\s', ''
        $der = [Convert]::FromBase64String($pem)
        $der.Length | Should -Be 44
        $raw = New-Object byte[] 32
        [Array]::Copy($der, 12, $raw, 0, 32)
        [Convert]::ToBase64String($raw) | Should -Be ([Convert]::ToBase64String((Get-MithrasReleaseSigningKey)))
    }
    It 'is not the all-zero key' {
        $k = Get-MithrasReleaseSigningKey
        ($k | Where-Object { $_ -ne 0 }).Count | Should -BeGreaterThan 0
    }
}

Describe 'Test-AgentBundleSignature — end to end' {
    BeforeAll {
        $script:bundlePath = Join-Path ([System.IO.Path]::GetTempPath()) "mithras-codesigning-test-$([guid]::NewGuid()).zip"
        # Exact bytes — no BOM, no trailing newline, or the digest will not match.
        [System.IO.File]::WriteAllBytes($bundlePath, [System.Text.Encoding]::UTF8.GetBytes($TestContent))
    }
    AfterAll {
        if (Test-Path -LiteralPath $script:bundlePath) { Remove-Item -LiteralPath $script:bundlePath -Force }
    }

    It 'computes the expected SHA-256' {
        (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLower() | Should -Be $TestSha
    }
    It 'accepts a correctly signed bundle' {
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 $TestSigB64 -ExpectedSha256 $TestSha -PublicKey (Hex $TestPub)
        $r.valid | Should -BeTrue
        $r.sha256 | Should -Be $TestSha
    }
    It 'rejects when the expected hash does not match' {
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 $TestSigB64 -ExpectedSha256 ('0' * 64) -PublicKey (Hex $TestPub)
        $r.valid | Should -BeFalse
        $r.reason | Should -Be 'sha256 mismatch'
    }
    It 'rejects a bundle signed by a different key' {
        # Correct hash, valid-looking signature, wrong trust anchor.
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 $TestSigB64 -ExpectedSha256 $TestSha -PublicKey (Hex $V3.Pub)
        $r.valid | Should -BeFalse
        $r.reason | Should -Match 'does not verify'
    }
    It 'rejects an empty signature' {
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 '' -ExpectedSha256 $TestSha -PublicKey (Hex $TestPub)
        $r.valid | Should -BeFalse
        $r.reason | Should -Be 'no signature supplied'
    }
    It 'rejects a signature that is not valid base64' {
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 'not!!base64!!' -ExpectedSha256 $TestSha -PublicKey (Hex $TestPub)
        $r.valid | Should -BeFalse
        $r.reason | Should -Match 'base64'
    }
    It 'rejects a base64 signature of the wrong length' {
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 ([Convert]::ToBase64String((New-Object byte[] 32))) -ExpectedSha256 $TestSha -PublicKey (Hex $TestPub)
        $r.valid | Should -BeFalse
        $r.reason | Should -Match '32 bytes, expected 64'
    }
    It 'rejects a missing bundle' {
        $r = Test-AgentBundleSignature -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'definitely-not-here.zip') -SignatureBase64 $TestSigB64
        $r.valid | Should -BeFalse
        $r.reason | Should -Be 'bundle not found'
    }
    It 'defaults to the real Mithras key when none is supplied, and so rejects the test fixture' {
        # Guards against a regression where the default trust anchor is
        # accidentally widened: the test-key signature must NOT verify
        # against the production key.
        $r = Test-AgentBundleSignature -Path $bundlePath -SignatureBase64 $TestSigB64 -ExpectedSha256 $TestSha
        $r.valid | Should -BeFalse
    }
    It 'detects a tampered bundle even when the signature is otherwise valid' {
        $tampered = Join-Path ([System.IO.Path]::GetTempPath()) "mithras-tampered-$([guid]::NewGuid()).zip"
        try {
            [System.IO.File]::WriteAllBytes($tampered, [System.Text.Encoding]::UTF8.GetBytes($TestContent + 'evil'))
            $r = Test-AgentBundleSignature -Path $tampered -SignatureBase64 $TestSigB64 -PublicKey (Hex $TestPub)
            $r.valid | Should -BeFalse
        } finally {
            if (Test-Path -LiteralPath $tampered) { Remove-Item -LiteralPath $tampered -Force }
        }
    }
}
