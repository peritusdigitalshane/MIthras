#requires -version 5.1
# ============================================================================
# Ed25519 signature verification for the agent self-update path.
#
# WHY THIS EXISTS
# ---------------
# Until v0.7.15 the updater verified only the SHA-256 of the downloaded
# bundle -- and that hash arrived in the SAME server message as the download
# URL. That proves transport integrity, not publisher authenticity: anyone
# able to write a row into public.agent_versions, or to queue an
# `upgrade_agent` command, could point the fleet at an arbitrary zip and
# supply a matching hash. The result was SYSTEM-level remote code execution
# on every managed endpoint.
#
# scripts/phase1/provision-signing-key.sh already generates an Ed25519
# keypair, scripts/phase2a/build-release.sh already signs each release, the
# server already returns `ed25519_sig`, and agent/contracts/agent-signing-public.pem
# has been committed since Phase 1. Only the verification half was missing.
# This module is that half.
#
# WHY A PURE-POWERSHELL IMPLEMENTATION
# ------------------------------------
# .NET Framework (which Windows PowerShell 5.1 runs on) has no Ed25519
# primitive -- System.Security.Cryptography gained ECDsa and RSA but never
# Ed25519. The alternatives were to ship a BouncyCastle DLL alongside the
# agent (a new unsigned binary on every endpoint, which is precisely the
# supply-chain surface we are trying to close) or to switch the signing
# scheme to RSA/ECDSA (invalidating the committed public key and every
# release already signed with it). Implementing RFC 8032 verification over
# System.Numerics.BigInteger keeps the existing keypair, adds no files to the
# install, and costs roughly a second of CPU once per update.
#
# WHAT IS SIGNED
# --------------
# build-release.sh signs the RAW 32 BYTES of the release zip's SHA-256
# digest (`printf '%s' "$SHA" | xxd -r -p | openssl pkeyutl -sign -rawin`),
# NOT the hex string and NOT the zip itself. Verify-AgentBundleSignature
# below reproduces exactly that: hash the file, pass the raw digest bytes as
# the Ed25519 message.
#
# TESTING
# -------
# tests/CodeSigning.Tests.ps1 runs the RFC 8032 section 7.1 test vectors plus
# tamper cases. Run them before touching anything in here.
# ============================================================================

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Curve constants (RFC 8032, edwards25519)
# ---------------------------------------------------------------------------

# p = 2^255 - 19
$script:Ed_P = [System.Numerics.BigInteger]::Pow(2, 255) - 19
# L = 2^252 + 27742317777372353535851937790883648493  (group order)
$script:Ed_L = [System.Numerics.BigInteger]::Pow(2, 252) + [System.Numerics.BigInteger]::Parse("27742317777372353535851937790883648493")

function _EdMod {
    param([System.Numerics.BigInteger]$A)
    # BigInteger % can return a negative remainder; normalise into [0, p).
    $r = $A % $script:Ed_P
    if ($r.Sign -lt 0) { $r = $r + $script:Ed_P }
    return $r
}

function _EdInv {
    param([System.Numerics.BigInteger]$A)
    # Fermat: a^(p-2) mod p. p is prime so this is the modular inverse.
    return [System.Numerics.BigInteger]::ModPow((_EdMod $A), $script:Ed_P - 2, $script:Ed_P)
}

# d = -121665 / 121666 mod p
$script:Ed_D = _EdMod ([System.Numerics.BigInteger](-121665) * (_EdInv ([System.Numerics.BigInteger]121666)))
# I = sqrt(-1) mod p = 2^((p-1)/4)
$script:Ed_I = [System.Numerics.BigInteger]::ModPow([System.Numerics.BigInteger]2, ($script:Ed_P - 1) / 4, $script:Ed_P)
# Lazily-built base point cache. Declared up front because Set-StrictMode
# -Version Latest makes reading an undeclared variable a terminating error.
$script:Ed_B = $null

# ---------------------------------------------------------------------------
# Point arithmetic — extended twisted Edwards coordinates (X, Y, Z, T),
# where x = X/Z, y = Y/Z, and T = XY/Z.
#
# The addition formula below (a = -1, "add-2008-hwcd-3") is COMPLETE for
# edwards25519: it is correct for every pair of points including doublings
# and the identity, so we deliberately do not special-case doubling. That
# removes the classic incomplete-addition bug class from this file entirely.
# ---------------------------------------------------------------------------

function _EdPoint {
    param(
        [System.Numerics.BigInteger]$X,
        [System.Numerics.BigInteger]$Y,
        [System.Numerics.BigInteger]$Z,
        [System.Numerics.BigInteger]$T
    )
    return ,@($X, $Y, $Z, $T)
}

function _EdAdd {
    param($P1, $P2)

    $X1 = $P1[0]; $Y1 = $P1[1]; $Z1 = $P1[2]; $T1 = $P1[3]
    $X2 = $P2[0]; $Y2 = $P2[1]; $Z2 = $P2[2]; $T2 = $P2[3]

    $a = _EdMod (($Y1 - $X1) * ($Y2 - $X2))
    $b = _EdMod (($Y1 + $X1) * ($Y2 + $X2))
    $c = _EdMod ($T1 * [System.Numerics.BigInteger]2 * $script:Ed_D * $T2)
    $d = _EdMod ($Z1 * [System.Numerics.BigInteger]2 * $Z2)
    $e = $b - $a
    $f = $d - $c
    $g = $d + $c
    $h = $b + $a

    return (_EdPoint (_EdMod ($e * $f)) (_EdMod ($g * $h)) (_EdMod ($f * $g)) (_EdMod ($e * $h)))
}

function _EdScalarMul {
    param($P, [System.Numerics.BigInteger]$K)

    # Identity in extended coordinates: (0, 1, 1, 0)
    $result = _EdPoint ([System.Numerics.BigInteger]::Zero) ([System.Numerics.BigInteger]::One) ([System.Numerics.BigInteger]::One) ([System.Numerics.BigInteger]::Zero)
    if ($K.IsZero) { return $result }

    # Double-and-add, most-significant bit first. Not constant-time — that is
    # acceptable here because both the scalar and the points are PUBLIC
    # values (signature component S, and the public key A). No secret is
    # processed by this module.
    $bits = $K.ToByteArray()   # little-endian, two's complement
    $topByte = $bits.Length - 1
    $started = $false
    for ($i = $topByte; $i -ge 0; $i--) {
        for ($bit = 7; $bit -ge 0; $bit--) {
            $isSet = (($bits[$i] -shr $bit) -band 1) -eq 1
            if (-not $started) {
                if (-not $isSet) { continue }
                $started = $true
                $result = $P
                continue
            }
            $result = _EdAdd $result $result
            if ($isSet) { $result = _EdAdd $result $P }
        }
    }
    return $result
}

# ---------------------------------------------------------------------------
# Encoding / decoding
# ---------------------------------------------------------------------------

function _EdBytesToBigInt {
    param([byte[]]$Bytes)
    # BigInteger(byte[]) reads little-endian two's complement. Append a zero
    # byte so a high bit in the last byte is never read as a sign bit.
    $buf = New-Object byte[] ($Bytes.Length + 1)
    [Array]::Copy($Bytes, $buf, $Bytes.Length)
    $buf[$Bytes.Length] = 0
    return (New-Object System.Numerics.BigInteger(, $buf))
}

function _EdBigIntTo32 {
    param([System.Numerics.BigInteger]$V)
    $raw = $V.ToByteArray()            # little-endian, possibly < or > 32 bytes
    $out = New-Object byte[] 32
    $n = [Math]::Min(32, $raw.Length)
    [Array]::Copy($raw, $out, $n)
    return , $out
}

function _EdDecompress {
    <#
        Recover the affine point encoded in 32 little-endian bytes.
        Returns $null on any malformed encoding — callers MUST treat $null
        as verification failure, never as "assume valid".
    #>
    param([byte[]]$Enc)

    if ($Enc.Length -ne 32) { return $null }

    $work = New-Object byte[] 32
    [Array]::Copy($Enc, $work, 32)
    $signBit = ($work[31] -shr 7) -band 1
    $work[31] = $work[31] -band 0x7F

    $y = _EdBytesToBigInt $work
    # Non-canonical encodings (y >= p) are rejected outright.
    if ($y -ge $script:Ed_P) { return $null }

    $yy = _EdMod ($y * $y)
    $u  = _EdMod ($yy - 1)
    $v  = _EdMod ($script:Ed_D * $yy + 1)

    # x = u * v^3 * (u * v^7)^((p-5)/8)
    $v3 = _EdMod ($v * $v * $v)
    $v7 = _EdMod ($v3 * $v3 * $v)
    $x  = _EdMod ($u * $v3 * [System.Numerics.BigInteger]::ModPow((_EdMod ($u * $v7)), ($script:Ed_P - 5) / 8, $script:Ed_P))

    $check = _EdMod ($v * $x * $x)
    if ($check -ne (_EdMod $u)) {
        if ($check -eq (_EdMod (-$u))) {
            # Wrong root — multiply by sqrt(-1).
            $x = _EdMod ($x * $script:Ed_I)
        } else {
            return $null   # y is not on the curve
        }
    }
    # Re-check after the correction; a still-failing value is off-curve.
    if ((_EdMod ($v * $x * $x)) -ne (_EdMod $u)) { return $null }

    # x = 0 with the sign bit set is the one encoding with no valid root.
    if ($x.IsZero -and $signBit -eq 1) { return $null }

    if ((($x % [System.Numerics.BigInteger]2)) -ne ([System.Numerics.BigInteger]$signBit)) {
        $x = _EdMod ($script:Ed_P - $x)
    }

    return (_EdPoint $x $y ([System.Numerics.BigInteger]::One) (_EdMod ($x * $y)))
}

function _EdCompress {
    param($P)
    $zInv = _EdInv $P[2]
    $x = _EdMod ($P[0] * $zInv)
    $y = _EdMod ($P[1] * $zInv)
    $out = _EdBigIntTo32 $y
    if ((($x % [System.Numerics.BigInteger]2)) -eq [System.Numerics.BigInteger]::One) {
        $out[31] = $out[31] -bor 0x80
    }
    return , $out
}

# Base point B: y = 4/5, x recovered with the even-x convention.
function _EdBasePoint {
    if ($null -ne $script:Ed_B) { return $script:Ed_B }
    $by = _EdMod ([System.Numerics.BigInteger]4 * (_EdInv ([System.Numerics.BigInteger]5)))
    $enc = _EdBigIntTo32 $by
    $script:Ed_B = _EdDecompress $enc
    return $script:Ed_B
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

function Test-Ed25519Signature {
    <#
    .SYNOPSIS
        Verify a detached Ed25519 signature (RFC 8032, PureEdDSA).
    .PARAMETER Message
        The exact bytes that were signed.
    .PARAMETER Signature
        64 raw bytes: R (32) || S (32).
    .PARAMETER PublicKey
        32 raw bytes of the compressed public key.
    .OUTPUTS
        [bool] — $true only if the signature is valid. Any malformed input
        returns $false; this function never throws on bad data, so a caller
        cannot accidentally convert a parse failure into a pass.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        # AllowEmptyCollection because Mandatory otherwise rejects a
        # zero-length array, and Ed25519 is defined over messages of any
        # length including empty (RFC 8032 s7.1 vector 1). Our own bundle
        # signatures are always over a 32-byte digest, but a primitive that
        # silently cannot verify the spec's first test vector is a primitive
        # nobody should trust.
        [Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Message,
        [Parameter(Mandatory)][byte[]]$Signature,
        [Parameter(Mandatory)][byte[]]$PublicKey
    )

    try {
        if ($Signature.Length -ne 64)  { return $false }
        if ($PublicKey.Length -ne 32)  { return $false }

        $rEnc = New-Object byte[] 32
        $sEnc = New-Object byte[] 32
        [Array]::Copy($Signature, 0,  $rEnc, 0, 32)
        [Array]::Copy($Signature, 32, $sEnc, 0, 32)

        # S must be canonically reduced. Unreduced S is the classic
        # signature-malleability vector; RFC 8032 requires this check.
        $s = _EdBytesToBigInt $sEnc
        if ($s -ge $script:Ed_L) { return $false }

        $aPoint = _EdDecompress $PublicKey
        if ($null -eq $aPoint) { return $false }

        $rPoint = _EdDecompress $rEnc
        if ($null -eq $rPoint) { return $false }

        # k = SHA512(R || A || M) reduced mod L
        $sha512 = [System.Security.Cryptography.SHA512]::Create()
        try {
            $buf = New-Object byte[] (64 + $Message.Length)
            [Array]::Copy($rEnc, 0, $buf, 0, 32)
            [Array]::Copy($PublicKey, 0, $buf, 32, 32)
            if ($Message.Length -gt 0) { [Array]::Copy($Message, 0, $buf, 64, $Message.Length) }
            $digest = $sha512.ComputeHash($buf)
        } finally {
            $sha512.Dispose()
        }
        $k = (_EdBytesToBigInt $digest) % $script:Ed_L

        # Valid iff  [S]B == R + [k]A
        $lhs = _EdScalarMul (_EdBasePoint) $s
        $rhs = _EdAdd $rPoint (_EdScalarMul $aPoint $k)

        $lhsEnc = _EdCompress $lhs
        $rhsEnc = _EdCompress $rhs

        $diff = 0
        for ($i = 0; $i -lt 32; $i++) { $diff = $diff -bor ($lhsEnc[$i] -bxor $rhsEnc[$i]) }
        return ($diff -eq 0)
    } catch {
        # Any unexpected condition is a verification FAILURE, never a pass.
        return $false
    }
}

function Get-MithrasReleaseSigningKey {
    <#
    .SYNOPSIS
        The trust anchor for agent releases: raw 32 bytes of the Ed25519
        public key from agent/contracts/agent-signing-public.pem.
    .DESCRIPTION
        Baked into the module deliberately. Reading it from a file on disk
        would let anyone with write access to C:\ProgramData\Mithras swap the
        trust anchor and defeat the whole control -- the key must travel with
        the code that uses it.

        Rotation procedure: publish a release signed with the OLD key that
        carries the NEW key in this function, let the fleet converge, then
        start signing with the new key. See docs/runbooks/publish-a-signed-agent-release.md.
    #>
    [OutputType([byte[]])]
    param()

    $hex = '7c6a004b0df51a26577fa061753e931f989a364d8fb3ddb7fcd7be704c8b05ca'
    $bytes = New-Object byte[] 32
    for ($i = 0; $i -lt 32; $i++) {
        $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
    }
    return , $bytes
}

function Test-AgentBundleSignature {
    <#
    .SYNOPSIS
        Verify a downloaded agent bundle against the baked-in release key.
    .DESCRIPTION
        Reproduces exactly what scripts/phase2a/build-release.sh signs: the
        RAW 32 bytes of the zip's SHA-256 digest (not the hex string, not the
        file contents).

        Also re-checks the expected hex digest when one is supplied, so a
        single call covers both the integrity and the authenticity halves.
    .PARAMETER Path
        Path to the downloaded .zip.
    .PARAMETER SignatureBase64
        Base64 Ed25519 signature as published in agent_versions.ed25519_sig.
    .PARAMETER ExpectedSha256
        Optional hex digest to cross-check before doing the curve maths.
    .PARAMETER PublicKey
        Test seam only. Defaults to the baked-in Mithras release key, which
        is what every production call uses. Overridable so the Pester suite
        can round-trip a freshly generated keypair without needing the real
        private key (which lives root-owned on the build VM). Anyone able to
        pass a different key here can already edit this module, so the
        override grants no privilege it did not already have.
    .OUTPUTS
        [hashtable] @{ valid = [bool]; sha256 = <hex>; reason = <string> }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        # AllowEmptyString so an absent/blank ed25519_sig from the server
        # lands on the clean "no signature supplied" refusal below instead of
        # throwing a parameter-binding exception the caller has to catch. An
        # unsigned release must fail closed and legibly, not noisily.
        [Parameter(Mandatory)][AllowEmptyString()][string]$SignatureBase64,
        [string]$ExpectedSha256,
        [byte[]]$PublicKey
    )

    if (-not $PSBoundParameters.ContainsKey('PublicKey')) {
        $PublicKey = Get-MithrasReleaseSigningKey
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return @{ valid = $false; sha256 = $null; reason = 'bundle not found' }
    }

    $hashHex = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()

    if ($ExpectedSha256) {
        if ($hashHex -ne $ExpectedSha256.ToLower()) {
            return @{ valid = $false; sha256 = $hashHex; reason = 'sha256 mismatch' }
        }
    }

    if ([string]::IsNullOrWhiteSpace($SignatureBase64)) {
        return @{ valid = $false; sha256 = $hashHex; reason = 'no signature supplied' }
    }

    $sig = $null
    try {
        $sig = [Convert]::FromBase64String($SignatureBase64.Trim())
    } catch {
        return @{ valid = $false; sha256 = $hashHex; reason = 'signature is not valid base64' }
    }
    if ($sig.Length -ne 64) {
        return @{ valid = $false; sha256 = $hashHex; reason = "signature is $($sig.Length) bytes, expected 64" }
    }

    # The signed message is the raw digest bytes.
    $digestBytes = New-Object byte[] 32
    for ($i = 0; $i -lt 32; $i++) {
        $digestBytes[$i] = [Convert]::ToByte($hashHex.Substring($i * 2, 2), 16)
    }

    $ok = Test-Ed25519Signature -Message $digestBytes -Signature $sig -PublicKey $PublicKey
    if ($ok) {
        return @{ valid = $true; sha256 = $hashHex; reason = 'ok' }
    }
    return @{ valid = $false; sha256 = $hashHex; reason = 'signature does not verify against the Mithras release key' }
}

Export-ModuleMember -Function Test-Ed25519Signature, Test-AgentBundleSignature, Get-MithrasReleaseSigningKey
