import { Bot, Brain, Shield, MessageSquare, AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

interface Agent {
  number: string;
  name: string;
  role: string;
  icon: React.ReactNode;
  description: string;
  example: string;
  accent: string;
}

const AGENTS: Agent[] = [
  {
    number: "01",
    name: "Triage Agent",
    role: "First-line classifier",
    icon: <AlertTriangle className="h-5 w-5" />,
    description:
      "Reads the alert plus endpoint context, threat history, and recent activity. Produces a verdict and confidence score in seconds.",
    example: "True positive · 0.95 confidence",
    accent: "from-orange-500/20 to-orange-500/5 border-orange-500/30",
  },
  {
    number: "02",
    name: "Verification Agent",
    role: "Independent re-classification",
    icon: <Brain className="h-5 w-5" />,
    description:
      "Runs the same alert through a different model and a different prompt. Catches the first agent's blind spots before any action is taken.",
    example: "Confirmed true positive · agrees with triage",
    accent: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
  },
  {
    number: "03",
    name: "Adversarial Agent",
    role: "Steelman the opposite verdict",
    icon: <Shield className="h-5 w-5" />,
    description:
      "Tries to refute the verdict using every counter-argument it can find. If it can't refute, that's the strongest signal of a real threat.",
    example: "Could not refute · proceed with response",
    accent: "from-red-500/20 to-red-500/5 border-red-500/30",
  },
  {
    number: "04",
    name: "Response Agent",
    role: "Picks the action",
    icon: <Bot className="h-5 w-5" />,
    description:
      "Chooses the right response: isolate the endpoint, kill the process, quarantine the file, or escalate to a human. Bounded by per-customer policy with automatic rollback.",
    example: "Isolated endpoint · rollback armed",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  },
  {
    number: "05",
    name: "Comms Agent",
    role: "Drafts the customer message",
    icon: <MessageSquare className="h-5 w-5" />,
    description:
      "Writes the customer notification and runbook entry in plain language, citing every piece of evidence it used. Your team approves it before it sends.",
    example: "Draft ready for review",
    accent: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
  },
];

export function AISocSection() {
  return (
    <section id="ai-soc" className="relative py-24 px-6 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-[800px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto max-w-6xl">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-6 border border-primary/20">
            <Bot className="h-3.5 w-3.5" />
            Meet your AI SOC
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.1]">
            Five agents.{" "}
            <span className="text-muted-foreground">One unified verdict.</span>
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Every alert passes through a chain of independent AI agents before
            any action runs. They check each other's work, refuse to act
            without consensus, and document every decision so you can audit
            exactly how a conclusion was reached.
          </p>
        </div>

        {/* Agent flow diagram — visual chain on desktop */}
        <div className="hidden lg:flex items-stretch justify-between gap-3 mb-16">
          {AGENTS.map((agent, idx) => (
            <div key={agent.number} className="flex items-start flex-1 min-w-0">
              <AgentCard agent={agent} />
              {idx < AGENTS.length - 1 && (
                <div className="flex items-center self-center px-1 text-muted-foreground/40">
                  <ArrowRight className="h-5 w-5" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile / tablet — stacked */}
        <div className="lg:hidden grid sm:grid-cols-2 gap-4 mb-16">
          {AGENTS.map((agent) => (
            <AgentCard key={agent.number} agent={agent} />
          ))}
        </div>

        {/* Outcomes strip — why this matters */}
        <div className="bg-card/40 backdrop-blur border border-border/40 rounded-2xl p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">
                Why an AI SOC beats a human one
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Traditional MDR sells you analysts watching screens. Analysts
                burn out, take holidays, and cost six figures. The AI SOC
                doesn't &mdash; and it applies the same rigour to alert
                number one and alert number one million.
              </p>
            </div>
            <div className="space-y-3">
              <OutcomePoint
                title="Triage in seconds, not minutes"
                detail="By the time a human SOC opens the ticket, our agents have already decided."
              />
              <OutcomePoint
                title="Coverage that doesn't sleep"
                detail="Public holiday, 3 AM, weekend &mdash; the agents are running. Always."
              />
              <OutcomePoint
                title="Consistent rigour at any scale"
                detail="Same model, same prompt, same standard on every alert."
              />
              <OutcomePoint
                title="Auditable by design"
                detail="Every verdict cites the evidence. No black-box judgement calls."
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className={`relative flex-1 min-w-0 rounded-xl border bg-gradient-to-br p-5 backdrop-blur ${agent.accent}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono tracking-wider text-muted-foreground/60">
          {agent.number}
        </span>
        <span className="text-foreground/80">{agent.icon}</span>
      </div>
      <h3 className="font-semibold text-base mb-1 leading-tight">{agent.name}</h3>
      <p className="text-xs text-muted-foreground/80 mb-3 uppercase tracking-wide">
        {agent.role}
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {agent.description}
      </p>
      <div className="text-xs font-mono text-foreground/70 bg-background/40 rounded px-2 py-1.5 border border-border/40">
        <span className="text-muted-foreground/60">&rarr;</span> {agent.example}
      </div>
    </div>
  );
}

function OutcomePoint({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground leading-snug">{detail}</p>
      </div>
    </div>
  );
}
