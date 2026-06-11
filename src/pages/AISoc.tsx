import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Bot, Brain, Shield, MessageSquare, AlertTriangle,
  CheckCircle2, Clock, Eye, Zap, FileText, Quote,
} from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";

interface Agent {
  number: string;
  name: string;
  role: string;
  icon: React.ReactNode;
  description: string;
  inputs: string;
  outputs: string;
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
      "Reads every incoming alert with the relevant endpoint context, threat history, recent firewall events, and Defender posture. Produces a verdict and confidence score in seconds.",
    inputs: "Alert · endpoint state · 7-day activity · threat catalogue",
    outputs: "Verdict (true_positive / false_positive / needs_human / inconclusive) · confidence · reasoning · key indicators",
    example: "true_positive · 0.95 · LSASS access from non-system binary · 3 prior similar detections this fortnight",
    accent: "from-orange-500/20 to-orange-500/5 border-orange-500/30",
  },
  {
    number: "02",
    name: "Verification Agent",
    role: "Independent re-classification",
    icon: <Brain className="h-5 w-5" />,
    description:
      "Runs the same alert through a different model and a different prompt. Doesn't see the first agent's verdict until it finishes its own. Catches blind spots before any action is taken.",
    inputs: "Same alert · same context (but no triage verdict yet)",
    outputs: "Independent verdict · confidence · disagreement flag if it diverges from triage",
    example: "Confirmed true_positive · 0.88 · agrees with triage",
    accent: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
  },
  {
    number: "03",
    name: "Adversarial Agent",
    role: "Steelman the opposite verdict",
    icon: <Shield className="h-5 w-5" />,
    description:
      "Fires only when triage said \"true positive\" or when triage and verification disagree. Its job is to refute. It looks at every counter-argument it can find — benign tools, similar names, scheduled tasks, vendor signatures. If it can't refute, that's the strongest signal of a real threat.",
    inputs: "Alert · triage verdict · verification verdict",
    outputs: "Refuted / not_refuted · counter-arguments considered · evidence for each",
    example: "not_refuted · considered 4 counter-arguments · none survived endpoint context check",
    accent: "from-red-500/20 to-red-500/5 border-red-500/30",
  },
  {
    number: "04",
    name: "Response Agent",
    role: "Picks the action",
    icon: <Bot className="h-5 w-5" />,
    description:
      "Decides what to do. Choices: isolate the endpoint, kill the process, quarantine the file, escalate to a human. Bounded by the per-customer response policy. Automatic rollback if anything goes wrong inside a 10-minute window.",
    inputs: "Consensus verdict · per-customer policy · endpoint criticality",
    outputs: "Action taken · rollback timer · confirmation token",
    example: "Isolated endpoint · rollback armed · confirmation pending operator",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  },
  {
    number: "05",
    name: "Comms Agent",
    role: "Drafts the customer message",
    icon: <MessageSquare className="h-5 w-5" />,
    description:
      "Writes the customer notification and the internal runbook entry in plain language, citing every piece of evidence used along the chain. Your team approves before it sends.",
    inputs: "Full agent chain · customer preferences · brand voice",
    outputs: "Draft customer email · runbook entry · cited evidence list",
    example: "Draft ready · 4 evidence links · awaiting operator approval",
    accent: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
  },
];

const OUTCOMES = [
  { title: "Seconds, not minutes", detail: "By the time a human SOC opens the ticket, the agents have already decided." },
  { title: "Coverage that doesn't sleep", detail: "Public holiday, 3 AM, weekend — the agents are running. Always." },
  { title: "Consistent rigour at any scale", detail: "Same model, same prompt, same standard on every alert." },
  { title: "Auditable by design", detail: "Every verdict cites the evidence. No black-box judgement calls." },
  { title: "Bounded action with rollback", detail: "Auto-response is policy-scoped. Anything looking wrong rolls back automatically." },
  { title: "Costs a fraction of MDR", detail: "Per-endpoint pricing, not per-analyst overheads." },
];

const FAQ = [
  {
    q: "Are the AI agents truly autonomous, or do you have humans in the loop?",
    a: "Triage, verification, adversarial review, and the response decision are autonomous. Communications drafts are produced autonomously but go through your operator before sending. Auto-response is bounded by per-customer policy and rolled back automatically if anything looks off inside a 10-minute window. You always have manual override.",
  },
  {
    q: "How do the agents avoid LLM hallucination?",
    a: "Three controls: (1) every agent uses citation-enforced structured output — no claim can be made without pointing at the evidence row it came from; (2) two independent agents must agree before any action runs; (3) the adversarial agent actively tries to refute the consensus and any successful refutation flips it back to human review.",
  },
  {
    q: "What models do you use under the hood?",
    a: "A mix. Triage and verification run on different model families so a shared bug can't fool both. The response agent uses a smaller, faster model because its job is structured selection from a fixed action set. Models are configurable per organisation if you have a preference or compliance requirement.",
  },
  {
    q: "What about my data — does it leave my tenant?",
    a: "Alert metadata and evidence pointers go to the model providers for inference. Raw file contents, credentials, and customer data don't. We track every LLM call by org for billing + audit.",
  },
  {
    q: "Can I see what the agents decided about a specific alert?",
    a: "Yes. Every alert has a full agent verdict trail in the SOC console — triage verdict, verification verdict, adversarial review, response taken, and the comms draft. Every line includes the evidence it cited.",
  },
];

const AISoc = () => {
  return (
    <>
      <Seo
        title="The Mithras AI SOC — 5 agents, always on. Endpoint security AI for MSPs."
        description="Meet the five-agent AI SOC behind Mithras Threat Defence: triage, verification, adversarial review, response, and communications. Each alert gets independent cross-checking, citation-enforced reasoning, and bounded auto-response — 24/7/365."
        canonical="/ai-soc"
      />
      <div className="min-h-screen bg-background">
        <LandingNav />

        {/* HERO */}
        <section className="relative pt-24 md:pt-32 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>
          <div className="container mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] sm:text-xs font-medium tracking-wide uppercase mb-6 sm:mb-8 border border-primary/20">
              <Bot className="h-3.5 w-3.5" />
              The Mithras AI SOC
            </div>
            <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.05] text-balance">
              Five agents.{" "}
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
                One unified verdict.
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8 sm:mb-10 leading-relaxed">
              Every alert passes through a chain of independent AI agents
              before any action runs. They check each other's work, refuse
              to act without consensus, and document every decision so you
              can audit exactly how a conclusion was reached.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 max-w-3xl mx-auto text-sm">
              <ProofPoint icon={<Clock className="h-4 w-4" />} label="Triage in seconds" />
              <ProofPoint icon={<Brain className="h-4 w-4" />} label="3-agent consensus" />
              <ProofPoint icon={<Eye className="h-4 w-4" />} label="24/7/365" />
              <ProofPoint icon={<Zap className="h-4 w-4" />} label="Citation-enforced" />
            </div>
          </div>
        </section>

        {/* HOW IT WORKS — the agent chain */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 sm:mb-12 md:mb-14">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                How an alert flows through the SOC
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                Each agent runs independently. None of them sees the next
                one's verdict until it's done. That's what makes the
                consensus meaningful.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {AGENTS.map((agent) => (
                <AgentCard key={agent.number} agent={agent} />
              ))}
            </div>
          </div>
        </section>

        {/* SAMPLE ALERT FLOW */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-4xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                A real example
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground">
                Sanitised verdict trail from a recent multi-agent run.
              </p>
            </div>

            <div className="bg-card/60 backdrop-blur border border-border/40 rounded-2xl p-4 sm:p-6 md:p-8 space-y-4">
              <FlowStep
                step="00"
                title="Alert raised"
                detail="Defender event 1116 · HackTool:Win64/Chisel!MTB · process powershell.exe · endpoint CMW-TS1"
              />
              <FlowStep
                step="01"
                title="Triage Agent"
                verdict="true_positive · 0.95"
                detail="Chisel is a known tunnelling tool · matches threat catalogue · endpoint shows recent legitimate admin activity but the parent process tree is suspicious"
              />
              <FlowStep
                step="02"
                title="Verification Agent"
                verdict="needs_human · 0.50"
                detail="Disagrees with triage. Notes that Chisel is sometimes used legitimately for emergency remote-access. Wants operator confirmation."
              />
              <FlowStep
                step="03"
                title="Adversarial Agent"
                verdict="not_refuted · 0.85"
                detail="Tried four counter-arguments. None survived: parent process is not a known admin tool, no scheduled task explains the launch, no recent ticket references emergency access, no IT change-management record."
              />
              <FlowStep
                step="04"
                title="Consensus"
                verdict="true_positive · disagreement_flagged"
                detail="Action: notify operator and stage isolation. Auto-isolate held pending operator approval because verification said needs_human."
              />
              <FlowStep
                step="05"
                title="Comms Agent"
                verdict="draft ready"
                detail="Customer email + runbook entry drafted with all 7 evidence citations. Operator approval queued in the SOC console."
              />
            </div>

            <p className="text-xs text-muted-foreground text-center mt-6">
              The full verdict trail is visible inside the SOC console for every alert your team handles.
            </p>
          </div>
        </section>

        {/* WHY AI SOC */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                Why an AI SOC beats a human one
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Traditional MDR sells you analysts watching screens. Analysts
                burn out, take holidays, and cost six figures. The AI SOC
                doesn't &mdash; and applies the same rigour to alert one and
                alert one million.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {OUTCOMES.map((o) => (
                <div key={o.title} className="rounded-xl border border-border/40 bg-card/50 backdrop-blur p-5">
                  <CheckCircle2 className="h-5 w-5 text-primary mb-3" />
                  <h3 className="font-semibold text-base mb-2">{o.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{o.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-muted/20">
          <div className="container mx-auto max-w-3xl">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 sm:mb-4 text-balance">
                Common questions
              </h2>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {FAQ.map((f, idx) => (
                <details key={idx} className="group rounded-xl border border-border/40 bg-card/50 backdrop-blur overflow-hidden">
                  <summary className="cursor-pointer px-5 py-4 font-medium text-sm sm:text-base list-none flex items-center justify-between gap-3 hover:bg-card/70 transition-colors">
                    <span>{f.q}</span>
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 text-center">
          <div className="container mx-auto max-w-3xl">
            <Quote className="h-10 w-10 mx-auto text-primary/40 mb-6" />
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 text-balance">
              Stop paying for analysts. Get an AI SOC that never sleeps.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              We&apos;ll walk through your current MDR coverage in a 30-minute
              demo and show you the agent verdict trail on live alerts.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
              <Button size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20 w-full sm:w-auto" asChild>
                <Link to="/contact-sales">
                  Book a demo
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base w-full sm:w-auto" asChild>
                <Link to="/platform">
                  <FileText className="mr-2 h-4 w-4" />
                  See the platform
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
};

function ProofPoint({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-card/50 backdrop-blur text-muted-foreground">
      <span className="text-primary">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className={`relative flex flex-col rounded-xl border bg-gradient-to-br p-5 backdrop-blur ${agent.accent}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono tracking-wider text-muted-foreground/60">{agent.number}</span>
        <span className="text-foreground/80">{agent.icon}</span>
      </div>
      <h3 className="font-semibold text-base mb-1 leading-tight">{agent.name}</h3>
      <p className="text-xs text-muted-foreground/80 mb-3 uppercase tracking-wide">{agent.role}</p>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{agent.description}</p>
      <div className="space-y-2 text-xs mt-auto">
        <div className="bg-background/40 rounded px-2 py-1.5 border border-border/40">
          <span className="text-muted-foreground/60 uppercase tracking-wide text-[10px] block mb-0.5">Reads</span>
          <span className="text-foreground/70">{agent.inputs}</span>
        </div>
        <div className="bg-background/40 rounded px-2 py-1.5 border border-border/40">
          <span className="text-muted-foreground/60 uppercase tracking-wide text-[10px] block mb-0.5">Writes</span>
          <span className="text-foreground/70">{agent.outputs}</span>
        </div>
        <div className="font-mono text-[11px] bg-background/40 rounded px-2 py-1.5 border border-border/40 text-foreground/70">
          <span className="text-muted-foreground/60">&rarr;</span> {agent.example}
        </div>
      </div>
    </div>
  );
}

function FlowStep({ step, title, verdict, detail }: { step: string; title: string; verdict?: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="flex-shrink-0 h-9 w-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center font-mono text-xs text-primary">
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
          <h3 className="font-semibold text-sm sm:text-base">{title}</h3>
          {verdict && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-foreground/5 border border-border/40 text-foreground/80">
              {verdict}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

export default AISoc;
