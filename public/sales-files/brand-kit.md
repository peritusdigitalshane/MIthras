# Mithras Brand Kit

What to say, what to show, what NOT to do. Use this for every customer-facing
asset — slides, ads, blog posts, emails, sticker designs.

---

## Name

**Mithras Threat Defence** (formal) — use on legal docs, contracts, the first slide.
**Mithras** (everyday) — use everywhere else.

Never **mithras**, **MITHRAS**, **MTD**, or **Mithras Endpoint Defender**.

Pronunciation: **MITH-rass** (rhymes with "with us"). Stress on first syllable.

## Origin / one-liner

> "Named after the Roman god of light, contracts, and protection — Mithras the
> platform protects Australian small businesses from the ransomware, phishing,
> and identity attacks the big EDR vendors ignored. Built by Mithras
> in Australia."

Use this when someone asks "why Mithras?" Don't go deeper unless asked again.

## Voice & tone

- **Direct, not corporate.** Write like you're talking to a busy MSP owner who's heard every sales pitch.
- **Australian English.** "Centre", "colour", "organisation", "labour", "endpoint" (not "device" unless context demands).
- **Concrete > abstract.** "Catches mailbox-rule injection" beats "advanced identity threat detection."
- **Numbers earn trust.** "60% false-positive reduction in our own SOC" beats "dramatically reduces noise."
- **Self-deprecating, not arrogant.** We compete with billion-dollar US vendors. Punch up, never down.

## Things never to say

- "Enterprise-grade" — empty marketing phrase.
- "Next-generation" — meaningless.
- "Best-in-class" — let the customer say it about you.
- "Game-changer" — never.
- "Disruptive" — never.
- "AI-powered" without saying what it actually does.
- Any sentence containing "leverage" or "synergy."

## Things always to do

- Name the actual product capability ("Defender behaviour monitor state").
- Cite the actual source for stats (ASD ACSC, Sophos State of Ransomware, etc.).
- Show a screenshot, not an illustration, when there's a real one available.
- Talk about a real customer scenario (anonymised) — every slide deck should have one.

---

## Visual identity

### Logo

- Primary: full Mithras wordmark with emblem to the left. `/public/mithras-emblem.svg`.
- Emblem-only: square favicon usage. `/public/mithras-icon-512.png`.
- Wordmark-only: ultra-wide layouts (banner ads).

**Clearspace**: minimum padding around logo = the height of the "M" in Mithras.

**Don't**: recolour, skew, stretch, add drop shadows, change the typography.

### Colours

| Use | Hex | Token |
|---|---|---|
| Primary (Mithras gold) | `#D4A437` (approx) | `primary` |
| Background dark | `#0B0C0E` | `background` |
| Background light | `#FAFAFA` | `background` (light mode) |
| Foreground | `#E8E8EA` (dark) / `#0B0C0E` (light) | `foreground` |
| Status — healthy | `#10B981` (emerald-500) | — |
| Status — warning | `#F59E0B` (amber-500) | — |
| Status — critical | `#F43F5E` (rose-500) | — |

Exact tokens live in `src/index.css` under `:root` and `.dark` — never hardcode hex in the platform UI.

### Typography

- **Headings**: Inter (or system sans-serif fallback). Weight 700.
- **Body**: Inter, weight 400-500.
- **Mono / code**: JetBrains Mono or system monospace fallback. Used for invoice numbers, agent IDs, snippets.

Never use serifs. Never use display fonts (Comic Sans, you're not going on this).

### Iconography

- Lucide icons throughout the platform. Use Lucide on slides too — sized at 1em with neutral foreground colour.
- One icon per concept. Don't combine.

### Imagery

- Prefer screenshots over stock photography.
- No stock photos of "hackers in hoodies." Ever.
- If you need a hero image, use abstract gradients or product UI close-ups.

---

## Email templates

Subject lines:
- Short: under 50 chars.
- Action-oriented: "Demo on Thursday?" beats "Following up on our recent conversation about Mithras."

Body:
- Open with one sentence acknowledging context. No "I hope this email finds you well."
- One ask per email. Never bury two CTAs.
- Sign-off as a human, not a department.

## Social

- LinkedIn is the primary channel for B2B reach.
- Twitter/X is the channel for engineering-led posts (deep dives, postmortems).
- Don't post on Facebook or Instagram. Wrong audience.

Frequency: 2-3 posts/week max. Quality > volume.

---

## Distributor co-branding

The platform is **single-brand Mithras**. Distributors don't get white-label — but they CAN say:

- "Authorised distributor of Mithras Threat Defence"
- "Mithras + [distributor name] — your channel partner"
- "Powered by Mithras"

What they CAN'T say:

- "[Distributor name] Cybersecurity Platform" (implies they built it)
- "Built by [distributor name]" (false)
- Use the Mithras logo without "Authorised distributor" disclaimer

Source files (PDFs, deck templates) sit in Supabase Storage under `marketing-assets/` and are linked from `/distributor/resources` inside the platform.
