import { MainLayout } from "@/components/layout/MainLayout";
import { AppWhitelistDashboard } from "@/components/security/AppWhitelistDashboard";
import { PageHelp } from "@/components/help/PageHelp";

export default function AppWhitelisting() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">Application Whitelisting</h1>
            <PageHelp
              title="Application Whitelisting"
              glossaryAnchor="/glossary#app-whitelisting"
              whatIsThis={
                <>
                  <p>
                    Per-endpoint lockdown of which binaries are allowed to run. Start an audit
                    to learn what binaries actually run on each machine, then enforce — anything
                    not on the whitelist is terminated on launch.
                  </p>
                  <p>
                    Works on every Windows SKU including EOL boxes. Match rules support SHA-256
                    hash, Authenticode publisher, file path, or compound "trusted path".
                  </p>
                </>
              }
              tasks={[
                { label: "Pick an endpoint" },
                { label: "Click Start audit to observe process launches" },
                { label: "Wait ~24 hours so all your normal apps run at least once" },
                { label: "Review the observed-apps table — click 'Add' on apps you trust" },
                { label: "Click Enforce — anything not whitelisted is now killed on launch", detail: "Seeds OS paths (System32, Program Files, Mithras itself) so the box doesn't brick." },
              ]}
              faq={[
                {
                  q: "What's the difference between this and WDAC?",
                  a: (
                    <>
                      <p>
                        AppWhitelist uses a WMI process-watcher in user space — works everywhere
                        but has a ~30s race window where a malicious binary briefly runs before
                        being terminated.
                      </p>
                      <p>
                        WDAC is Microsoft's kernel-level engine — zero race window, but only
                        available on Win10/11 Enterprise + Server 2016+. Mithras can run both.
                      </p>
                    </>
                  ),
                },
                {
                  q: "What is a 'trusted_path' rule?",
                  a: <p>Compound rule: the binary must be in this path glob AND signed by this publisher. Closes the "drop unsigned payload into a trusted folder" bypass.</p>,
                },
                {
                  q: "How do I un-enforce?",
                  a: <p>Click Stop in the dashboard. The agent reverts within ~30 seconds.</p>,
                },
              ]}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Per-endpoint app lockdown. Learn what runs, allowlist it, then block everything else.
          </p>
        </div>

        <AppWhitelistDashboard />
      </div>
    </MainLayout>
  );
}
