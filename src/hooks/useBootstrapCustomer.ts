import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BootstrapResult {
  organization_id: string;
  slug: string;
  default_group_id: string;
  defender_policy_id: string | null;
  uac_policy_id: string | null;
  windows_update_policy_id: string | null;
  enrollment_token: string;
  token_max_uses: number;
  token_expires_at: string;
}

export interface BootstrapInput {
  name: string;
  slug: string;
}

/**
 * Provision a new customer end-to-end in a single RPC: org, super-admin
 * membership, baseline UAC / Windows Update policies, default endpoint group,
 * and a 50-use enrolment token valid 30 days.
 */
export function useBootstrapCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BootstrapInput): Promise<BootstrapResult> => {
      const { data, error } = await supabase.rpc("bootstrap_customer", {
        p_name: input.name.trim(),
        p_slug: input.slug.trim(),
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("bootstrap_customer returned no data");
      return data as unknown as BootstrapResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-organizations"] });
      qc.invalidateQueries({ queryKey: ["admin-organizations-with-stats"] });
    },
  });
}

export function buildInstallOneLiner(args: {
  apiBase: string;
  downloadUrl: string;
  sha256: string;
  token: string;
  version: string;
}) {
  const { apiBase, downloadUrl, sha256, token, version } = args;
  return [
    "$ErrorActionPreference='Stop'",
    `$zip = Join-Path $env:TEMP "mithras-agent-${version}.zip"`,
    '$dir = Join-Path $env:TEMP "mithras-agent-install"',
    `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile $zip -UseBasicParsing`,
    `if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne "${sha256}") { throw "SHA256 mismatch - refusing to install." }`,
    "if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }",
    "Expand-Archive -Path $zip -DestinationPath $dir -Force",
    `& (Join-Path $dir "install-agent.ps1") -EnrollmentToken "${token}" -ApiBaseUrl "${apiBase}" -Force`,
  ].join("; ");
}

export async function fetchActiveAgentManifest(token: string): Promise<{
  version: string;
  download_url: string;
  sha256: string;
  api_base_url: string;
}> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = new URL(`${supabaseUrl}/functions/v1/agent-installer`);
  url.searchParams.set("token", token);
  url.searchParams.set("runtime", "powershell");
  const resp = await fetch(url.toString(), { headers: { apikey: anon } });
  if (!resp.ok) throw new Error(`agent-installer ${resp.status}`);
  const data = await resp.json();
  return {
    version: data.latest_version,
    download_url: data.download_url,
    sha256: data.sha256,
    api_base_url: data.api_base_url,
  };
}
