# Mithras Pitch Deck Outline (10 slides)

Convert this to Keynote / Google Slides / PowerPoint with the Mithras brand kit
(see `brand-kit.md`). Each slide has a 30-second talk track in italics. Keep
total time to 10 minutes so the demo has room.

---

## Slide 1 — Title

**Mithras Threat Defence**
*Enterprise security. Built for small business.*

*[Logo, distributor's logo as "Authorised partner — [Distributor Name]" badge. Single accent gradient background. No body text — let the audience read.]*

> "Hi, I'm [name] from [distributor]. The next 10 minutes are about why every one of your SMB clients should be on Mithras by Christmas — and how it pays for itself."

---

## Slide 2 — The SMB security gap

Three statistics, one per row:

- **70%** of cyberattacks in 2025 targeted SMBs (under 250 staff). *(Source: ASD ACSC threat report)*
- **$48,000** average ransomware payout demanded of an Australian SMB. *(Source: Sophos State of Ransomware)*
- **<5%** of SMBs run any kind of EDR. *(Source: Gartner SMB security survey)*

> "Your customers are the target. They know they're the target. And they keep telling you it's too expensive to fix. This deck is about why that's no longer true."

---

## Slide 3 — Why the big players don't work for SMB

Two-column comparison:

**CrowdStrike, SentinelOne, Huntress…**
- $8–$15 per seat retail
- 25-seat minimum
- New agent to deploy + Defender turned off
- Won't support Windows 7 / Server 2012
- Per-tenant complexity

**Mithras Threat Defence**
- $15 retail / $7–$11 wholesale at scale
- 1-seat minimum
- Uses the Defender that's already installed
- Hardens old Windows boxes others abandon
- Multi-tenant first-class

> "We didn't try to be cheaper CrowdStrike. We rebuilt the stack around the realities of small businesses — including the old boxes nobody else will touch."

---

## Slide 4 — What Mithras actually does (5 pillars)

Five icons across, one line each:

1. 🛡️ **Defender as EDR** — policy push, threats, posture
2. 🪟 **EOL Windows hardening** — Win7/Server 2012 controls
3. 🤖 **AI SOC** — auto-triage every alert with citation-backed reasoning
4. ☁️ **M365 ITDR** — identity threats, mailbox rules, OAuth grants
5. 🖥️ **Remote desktop** — embedded MeshCentral, one click

> "Five capabilities, one console, one agent. The pillars on either end — EOL hardening and embedded remote — are differentiators no one else has."

---

## Slide 5 — Demo (5 mins)

*[Slide is just the customer's name + "Live demo".]*

> "Let me show you my own production tenant. Quick warning — anything you see on this screen is one of my real customers' actual telemetry, redacted. Stop me at any point with questions."

*[Switch to platform. Follow `demo-script.md`.]*

---

## Slide 6 — The differentiator: EOL Windows hardening

One slide on this alone — it's the wedge.

- 4 of 5 Australian SMB clients have at least one Win7 / Server 2008/2012 box
- CrowdStrike, Defender for Endpoint Plan 2, SentinelOne all dropped support
- Mithras applies GPO + WDAC + Sysmon + Defender forced-update where possible — turns these boxes from "rogue" to "auditor-acceptable"

> "If your client has even one of these boxes, this slide alone justifies the platform. None of the big players will sell them anything for it."

---

## Slide 7 — The AI SOC story

Two columns:

**Without Mithras**
- Alert fires, JSON blob lands in inbox
- Analyst spends 25 minutes investigating
- 80% of alerts are noise

**With Mithras AI SOC**
- Alert fires, LLM auto-triages with citation chain
- Operator gets "what happened, what to do, confidence"
- False-positive rate down 60% in our own SOC

> "We didn't build AI for marketing. We built it because our own SOC team was drowning. The model writes citations that lead back to the exact log lines. If the AI lies, the citation chain catches it."

---

## Slide 8 — Pricing & margin

One product, one price band. Channel-sold.

| Tier | Pays | Per seat / month (AUD) |
|---|---|---|
| End customer | Reseller | **$11** |
| Reseller | Distributor (or Mithras direct) | **$8** |
| Distributor | Mithras | **$6** |

Reseller margin: **$3/seat (27%)**. Distributor margin: **$2/seat (25%)**.

*[Worked example: 50 seats → $550/mo retail, $150/mo reseller margin, $100/mo distributor margin, recurring.]*

> "Numbers up front, no surprises. Reseller earns $3 on every seat they ship, distributor earns $2. On a 50-seat customer that's $150/month for the reseller and $100/month for the distributor — recurring, every month, as long as the customer's on the platform."

---

## Slide 9 — Why now

- **Cybersecurity Strategy 2030**: SMBs forced toward "essential 8" baseline by 2027
- **Insurance underwriters**: demanding EDR-class telemetry before issuing cyber policies
- **Defender already there**: every Windows 10/11 box. We unlock it.

> "Two government-shaped tailwinds are about to push every SMB into the market. The ones who lock in a security platform in the next 12 months will rebuild compliance once. The ones who don't will scramble in 2027."

---

## Slide 10 — Next step

Three options, one button per row:

1. **15-minute custom demo** for your sales team — book a slot
2. **Distributor agreement** + onboarding session — email channel@mithras.com.au
3. **Pilot tenant** — set up 50 free seats for an existing customer this week

> "Pick one. I'd rather close on a pilot tenant for a real customer right now than ten more meetings. If you've got someone you can call after this, let's set them up today."

---

## Speaker tips

- Don't read the slides. The audience reads faster than you talk.
- The demo is the deal. Every slide before it is setup; every slide after is paperwork.
- Always end with "what's the next concrete step?" — never "what do you think?"
- If they pause, ask: *"What would have to be true for you to roll this out across your book?"*
