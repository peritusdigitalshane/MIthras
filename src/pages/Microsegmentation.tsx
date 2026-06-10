import { MainLayout } from "@/components/layout/MainLayout";
import { MicrosegmentationDashboard } from "@/components/network/MicrosegmentationDashboard";
import { PageHelp } from "@/components/help/PageHelp";

export default function Microsegmentation() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-foreground">Microsegmentation</h1>
            <PageHelp
              title="Microsegmentation"
              glossaryAnchor="/glossary#microsegmentation"
              whatIsThis={
                <>
                  <p>
                    Build a per-endpoint firewall rule set from observed traffic. The agent
                    watches every connection for a learning window (usually 7 days), then you
                    click <b>Enforce</b> and anything not seen during learning gets blocked.
                  </p>
                  <p>
                    Each endpoint gets its own private group (<code>system:microseg:&lt;id&gt;</code>)
                    so rules never leak to siblings.
                  </p>
                </>
              }
              tasks={[
                { label: "Pick an endpoint from the dropdown" },
                { label: "Click Start learning to begin observation" },
                { label: "Wait at least 7 days for a representative baseline", detail: "Run longer if you have monthly batch jobs that need to be observed too." },
                { label: "Review the observed-traffic table" },
                { label: "Click Enforce — anything not in the table is now blocked", detail: "Idempotent and stoppable at any time." },
              ]}
              faq={[
                {
                  q: "What's the difference between inbound and outbound?",
                  a: (
                    <>
                      <p>
                        <b>Inbound</b> rules govern traffic <i>into</i> the endpoint (clients
                        connecting to a server's open ports). <b>Outbound</b> rules govern
                        traffic <i>out</i> of the endpoint (the machine reaching other services).
                      </p>
                      <p>You can enforce one direction without the other — useful when you only want to lock down what the machine receives.</p>
                    </>
                  ),
                },
                {
                  q: "Will Enforce break my services?",
                  a: <p>Only if a port wasn't observed during learning. Run learning longer if you have monthly/quarterly batch jobs. You can also add manual rules to cover known maintenance windows.</p>,
                },
                {
                  q: "How do I un-enforce?",
                  a: <p>Click Stop on the endpoint state machine. The agent removes its block rules on the next policy pass (usually within 5 minutes).</p>,
                },
                {
                  q: "Why per-endpoint, not per-group?",
                  a: <p>So rules for endpoint A don't accidentally block traffic on endpoint B in the same group. Each endpoint owns its own private microseg group; the dashboard manages all of them.</p>,
                },
              ]}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Per-endpoint allowlist of network ports. Learn what's normal, then lock everything else out.
          </p>
        </div>

        <MicrosegmentationDashboard />
      </div>
    </MainLayout>
  );
}
