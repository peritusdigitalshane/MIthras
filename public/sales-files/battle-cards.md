# Mithras Competitive Battle Cards

One card per major competitor. Sales reps memorise these. **All claims here
must be verifiable** — if you can't point to a source or a screen, don't say it.

---

## vs. CrowdStrike Falcon

**Their pitch**: "The gold standard of EDR. Used by the Fortune 500."

**The truth for SMBs**:
- Starts around USD $8.99/seat ($14/AUD) at MSRP, and even partner pricing rarely lands under $7 USD.
- 25-seat minimum is common in channel deals.
- Falcon agents don't support Windows 7 / Server 2008 / Server 2012. Period.
- Multi-tenant management is doable but tooling is generic — Falcon Insight MSSP exists but is a separate product.

**How to handle "we already use Falcon"**:
> "Great — keep it for your enterprise customers. Mithras isn't trying to replace Falcon for a 500-seat client. We're for the 200 customers you turn away because they have 12 seats and three Windows 7 boxes."

**Where Mithras wins**:
- Price-per-seat for SMB
- Old Windows support
- Built-in MSP multi-tenant ergonomics
- AI SOC triage is in-product, not a separate $$$ console

**Where Falcon still wins**:
- Brand trust at enterprise board level
- Threat hunting depth (Falcon Insight)
- 24/7 managed SOC team available at Premium tier

---

## vs. Huntress

**Their pitch**: "MSP-built, Defender-augmented threat hunting."

**The truth**:
- USD $4.50–$7/seat in channel deals. Comparable to Mithras retail.
- Specifically built for MSPs — fair admission, this is the most direct competitor.
- Heavy reliance on Huntress's own SOC team (humans-in-the-loop) — premium tier required for fastest response.
- No M365 ITDR equivalent — they do have ITDR but it's bolt-on.
- No EOL Windows hardening story.
- No embedded remote desktop — they integrate with ConnectWise/NinjaOne instead.

**How to handle "we already use Huntress"**:
> "Honestly, Huntress is the closest in spirit. Where Mithras pulls ahead for you is EOL Windows hardening, embedded MeshCentral remote, and the AI SOC triage that runs without paying their human-SOC tier. Same Defender story, much wider feature surface."

**Where Mithras wins**:
- EOL Windows hardening (unique)
- Embedded remote desktop
- AI SOC built into the base tier (Huntress charges premium for managed SOC analyst time)
- Microsegmentation + app whitelisting in the platform
- Australian-built, AUD-billed, AU support hours

**Where Huntress still wins**:
- 24/7 human SOC team responding to alerts
- Established brand in the MSP community
- Strong existing PSA integrations

---

## vs. Microsoft Defender for Endpoint Plan 2

**Their pitch**: "The first-party EDR, comes free with M365 E5."

**The truth**:
- "Free" only if customer is on E5 (~$57/seat). Most SMBs are on Business Premium ($22) or lower.
- Per-seat Plan 2 standalone: USD $5.20 — but Microsoft licensing minimums make multi-tenant management painful.
- Multi-tenant management requires Microsoft Defender XDR which needs Microsoft Partner status + Lighthouse + delegated admin.
- No native AU MSP pricing tier.
- Won't support Windows 7 / 2008 either.

**How to handle "the customer is already on E5"**:
> "Then they've already got the Defender agent. Mithras gives you the multi-tenant console + AI SOC + EOL hardening on top, without us needing them to keep paying E5 just for security telemetry. If they drop down to Business Premium next year, you keep your security console."

**Where Mithras wins**:
- Multi-tenant management without Microsoft Partner gymnastics
- AI SOC triage in-product
- Works whether the customer is on E5, Business Premium, or Standard
- EOL Windows hardening
- Predictable AUD pricing per seat regardless of M365 SKU

**Where Defender for Endpoint Plan 2 still wins**:
- Bundled into E5
- Direct from Microsoft (procurement teams like this)
- Deepest integration into the rest of the Microsoft security stack

---

## vs. SentinelOne Singularity

**Their pitch**: "Behavioral AI-driven EDR / XDR."

**The truth**:
- USD $10–$14/seat at SMB scale.
- MSP-friendly via Singularity for MSSPs but multi-tenant ergonomics are dated.
- No EOL Windows support.
- Strong on Linux/Mac — Mithras is currently Windows-only.

**How to handle**:
> "If you've got Linux server fleets, S1 is real. For Windows-dominant SMB books, Mithras at a third the price gives you Defender-native EDR plus all the MSP tooling S1 charges Singularity for MSSPs to bolt on."

**Where Mithras wins**:
- SMB pricing
- EOL Windows
- AU support + AUD billing
- MSP-first multi-tenant from day one

**Where SentinelOne wins**:
- Linux + Mac coverage
- AI behavioral engine (their model, our LLM triage; different problem space)
- Brand presence in larger enterprise deals

---

## vs. Avanan / Check Point Harmony Email

**Their pitch**: "API-driven email security for M365 and Google Workspace."

**The truth**:
- Email-only — they don't do endpoint, identity, or RMM.
- Strong product, complementary not competitor in many deals.

**How to handle**:
> "Avanan does one thing — inbox security — really well. Mithras does endpoint + identity + EOL + remote. If your customer needs both, sell both. We don't overlap."

**Where Mithras wins**: Different product category. Don't try to displace email-only tools — co-sell.

---

## vs. Acronis Cyber Protect

**Their pitch**: "Backup + cyber in one platform."

**The truth**:
- Real strength in backup. Cyber side is mid-tier — uses Acronis Cyber Protect's own malware engine, not Defender.
- Heavy resource use on endpoints.
- Strong channel pricing.

**How to handle**:
> "Acronis is backup-first, security second. If your customer needs the backup story, Acronis is a strong choice — and Mithras runs alongside it without conflict because we use Defender, not a second AV engine. Sell both."

**Where Mithras wins**: Better security depth, lighter agent, AI SOC.
**Where Acronis wins**: Backup story, image-level recovery, longstanding channel relationships.

---

## vs. Sophos Intercept X / Sophos Central

**Their pitch**: "Enterprise EDR + firewall + email + cloud in one console."

**The truth**:
- Established MSP channel via Sophos Partner Program.
- USD $4.50–$7/seat in channel deals.
- Heavyweight agent — more resource cost than Defender.
- Multi-tenant management via Sophos Central Partner.

**How to handle**:
> "Sophos has the channel depth Mithras hasn't built yet — fair. But the agent is heavy, you're paying for an extra AV engine when Defender's already there, and the Australian SOC support is from APAC HQ not Australia. Mithras is lighter, native to Windows Defender, and built in Sydney."

**Where Mithras wins**: Defender-native (no second agent), Australian support, AI SOC.
**Where Sophos wins**: Channel maturity, on-prem firewall integration, wider OS support.

---

## Universal rules

1. **Never trash a competitor by name in a meeting.** Talk about the category gap, not the company.
2. **Always concede something.** If you say a competitor has zero strengths, your audience knows you're lying.
3. **Anchor on customer outcome, not product feature.** "Stopping ransomware at the 8-seat dental clinic" beats "we have behavioural ML."
4. **Re-confirm pricing per `pricing-sheet.md` before quoting.** Numbers move.
