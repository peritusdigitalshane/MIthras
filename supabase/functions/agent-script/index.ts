// agent-script -- serves the Mithras Threat Defence Agent install one-liner.
//
// The bootstrap PowerShell script downloads the latest agent bundle ZIP from
// Storage, verifies its SHA256 against the latest.json manifest, extracts
// it to a temp dir, and runs install-agent.ps1.
//
// Usage on the customer endpoint (PowerShell, as Administrator):
//   iex (irm "https://api.mithras.com.au/functions/v1/agent-script")
//
// Optional query params:
//   ?org=<org_uuid>            future use; not needed for legacy-upgrade migration
//   ?enrollment_token=<token>  for NEW installs (no legacy agent.json)
//   ?api=<base_url>            override the api base (default api.mithras.com.au)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_API_BASE_URL = Deno.env.get("PUBLIC_API_BASE_URL") ?? "https://api.mithras.com.au";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);

  // B6 fix: the api param previously let any caller redirect the installed
  // agent to an attacker-controlled API host. Lock it down to known-good
  // hosts; ignore anything else and fall back to the public default.
  const ALLOWED_API_HOSTS = new Set([
    "api.mithras.com.au",
    "apidev.peritusdigital.com.au",
  ]);
  const requestedApi = url.searchParams.get("api") ?? "";
  let apiBase = PUBLIC_API_BASE_URL;
  if (requestedApi) {
    try {
      const u = new URL(requestedApi);
      if (u.protocol === "https:" && ALLOWED_API_HOSTS.has(u.host)) {
        apiBase = `${u.protocol}//${u.host}`;
      }
    } catch { /* keep default */ }
  }

  // B6 fix: enrollment_token must look like a Mithras enrolment code
  // (MTHX-XXXX-XXXX-XXXX) — strip anything else to prevent PowerShell
  // injection through the token query param. The old `replace(/['"\\]/g,"")`
  // sanitiser missed $() backtick newlines and other expansion vectors.
  const rawToken = url.searchParams.get("enrollment_token") ?? "";
  const enrollmentToken = /^[A-Z0-9-]{8,64}$/i.test(rawToken) ? rawToken : "";

  // Fetch latest.json from storage to learn current version + sha256
  let manifest: { version: string; filename: string; size: number; sha256: string } | null = null;
  try {
    const { data, error } = await supabase
      .storage
      .from("agent-bundles")
      .download("latest.json");
    if (error) {
      console.error("[agent-script] manifest download error:", error);
    } else {
      const text = await data.text();
      manifest = JSON.parse(text);
    }
  } catch (e) {
    console.error("[agent-script] manifest read failed:", e);
  }

  if (!manifest) {
    // Soft fallback: still serve a script but without sha verification.
    manifest = {
      version: "unknown",
      filename: "mithras-agent-latest.zip",
      size: 0,
      sha256: "",
    };
  }

  const downloadUrl = `${apiBase}/storage/v1/object/public/agent-bundles/${manifest.filename}`;

  // The PowerShell bootstrap. UTF-8 BOM keeps PowerShell happy regardless of
  // its console code page. Strings interpolated server-side; no user input
  // reaches the script body (manifest + apiBase are server-controlled).
  const script = buildBootstrap({
    version: manifest.version,
    downloadUrl,
    sha256: manifest.sha256,
    apiBase,
    enrollmentToken,
  });

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const scriptBytes = new TextEncoder().encode(script);
  const fullContent = new Uint8Array(bom.length + scriptBytes.length);
  fullContent.set(bom);
  fullContent.set(scriptBytes, bom.length);

  return new Response(fullContent, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});

function buildBootstrap(opts: {
  version: string;
  downloadUrl: string;
  sha256: string;
  apiBase: string;
  enrollmentToken: string;
}): string {
  const safeToken = opts.enrollmentToken.replace(/['"\\]/g, "");
  return `# Mithras Threat Defence Agent - bootstrap installer
# Version: ${opts.version}
# Downloads the bundle ZIP, verifies its SHA256, extracts, and runs install-agent.ps1.
# Re-run this script any time to upgrade. Existing endpoints keep their identity
# via the legacy-upgrade RPC -- no duplicates appear in the console.
#
# Usage on a target endpoint (PowerShell as Administrator):
#   iex (irm "https://api.mithras.com.au/functions/v1/agent-script")
#
# The whole body runs inside a script-block so the param() declarations are
# legal under Invoke-Expression (iex doesn't accept top-level param()).

& {
    [CmdletBinding()]
    param(
        [string]$ApiBaseUrl = '${opts.apiBase}',
        [string]$EnrollmentToken = '${safeToken}'
    )

    if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Mithras agent installer must run as Administrator."
    }

    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

    Write-Host '[mithras-install] Bootstrap v${opts.version}' -ForegroundColor Cyan

    $stage = Join-Path $env:TEMP "mithras-install-$([Guid]::NewGuid())"
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    try {
        $zipPath = Join-Path $stage 'mithras-agent.zip'
        Write-Host "[mithras-install] Downloading bundle..."
        Invoke-WebRequest -Uri '${opts.downloadUrl}' -OutFile $zipPath -UseBasicParsing -TimeoutSec 120

        $expected = '${opts.sha256}'
        if ($expected -and $expected.Length -eq 64) {
            $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
            if ($actual -ne $expected.ToLower()) {
                throw "SHA256 mismatch. Expected $expected, got $actual. Refusing to install."
            }
            Write-Host "[mithras-install] SHA256 verified."
        } else {
            Write-Warning "[mithras-install] No SHA256 in manifest - skipping verification (NOT RECOMMENDED)."
        }

        $unpacked = Join-Path $stage 'bundle'
        Expand-Archive -Path $zipPath -DestinationPath $unpacked -Force
        Write-Host "[mithras-install] Bundle extracted."

        $installer = Join-Path $unpacked 'install-agent.ps1'
        if (-not (Test-Path $installer)) { throw "Bundle is missing install-agent.ps1" }

        $installArgs = @{
            ApiBaseUrl = $ApiBaseUrl
            Force      = $true
        }
        if ($EnrollmentToken) { $installArgs['EnrollmentToken'] = $EnrollmentToken }

        & $installer @installArgs
    } finally {
        Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host '[mithras-install] Done.' -ForegroundColor Green
}
`;
}
