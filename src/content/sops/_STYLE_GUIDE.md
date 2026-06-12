# Mithras SOP style guide

Every Standard Operating Procedure published in `/help/sops` is read by paying
customers, channel partners, and Peritus operators. Quality is part of the
product. The bar is tier-1 production SaaS.

This guide is the contract every SOP must meet. If a procedure does not follow
this template, it is rewritten before publication. No exceptions for "drafts".

---

## 1. Document control

Every SOP carries this frontmatter, in this order:

```markdown
---
title: <Sentence-case statement of the procedure>
audience: <one of: peritus_super_admin, soc_operator, distributor, partner, customer_admin, customer_member, home_user>
description: <One sentence, < 160 chars. The catalogue index uses this.>
order: <Integer. Lower sorts first inside the audience.>
estimated_minutes: <Realistic read+execute time>
updated_at: <YYYY-MM-DD of the last substantive edit>
tags: <comma-separated, lower-kebab>
owner: Mithras Customer Operations
classification: Operational procedure
review_cadence: Quarterly
---
```

## 2. Required sections, in this order

1. **Purpose** — one short paragraph. What this procedure achieves and why
   it matters to the reader. No marketing copy.
2. **Audience and authority** — who is permitted to execute this. Name the
   role and the underlying authorisation (e.g. *"`organization_memberships.role` is
   `admin` or `owner`"*).
3. **Prerequisites** — bullet list of what must be true before starting.
4. **Procedure** — numbered steps. Each step states an action and the
   expected response. Use `code spans` for every UI label, path, button,
   table, column, RPC, and configuration value.
5. **Verification** — bullet list of objective checks. The reader must be
   able to confirm success without contacting support.
6. **Troubleshooting** — bullet list of named failure modes, each with a
   precise remediation. No "try refreshing".
7. **Audit and compliance** — what audit row is written, which notifications
   fire, what data is retained, and any relevant regulatory framing.
8. **Related procedures** — internal SOP links only. No external URLs.

## 3. Voice and tone

- Write to **a competent professional**. Explain what is non-obvious; do
  not explain what is widely known in their role.
- Tone is **calm, declarative, formal**. No exclamation marks. No emoji.
  No interjections ("well", "actually", "honestly"). No "we" / "our team".
- Address the reader as **you** in customer-facing SOPs. Use **the
  operator** in SOC and super-admin procedures.
- **Forbidden words and phrases**: *ping*, *loop in*, *smoke clears*,
  *easy peasy*, *quick fix*, *just do X*, *no worries*, *fast denial*,
  *quick and dirty*, *etc*, *and so on*, *blah blah*, *etc*. Replace with
  the precise equivalent.
- **Forbidden internal slang**: *disty*, *partner-portal*, *mithras land*,
  *the SOC team* (use *Peritus 24/7 SOC*), *the AI* (use *the AI Triage
  Agent* / *the Commander*), *the platform* without qualifier.
- **Forbidden hedging**: *probably*, *usually*, *most of the time*. State
  the deterministic condition or omit the sentence.

## 4. Formatting

- One H1 is the title (rendered from frontmatter); SOP body uses H2 / H3.
- Code spans for **every** UI label, path, button, command, column,
  configuration value, RPC, table, edge function.
- No bare URLs. Linked text inside Markdown links.
- Acronyms expanded on first use within each SOP (RPC, RPO, SLA, MFA).
- No screenshots until the screenshot pipeline ships. Until then, name
  every visible element precisely so the reader can locate it without
  ambiguity.
- Lists end with full stops. Sentence fragments are acceptable for
  glossary-style bullets but maintain consistency within a section.

## 5. Compliance lens

Every procedure that mutates production state names what audit record is
written and to which table. Examples that *must* be included where
applicable:

- "An entry is written to `public.activity_logs` with `action_type =
  'policy_assigned'` and `actor_id = auth.uid()`."
- "An email is dispatched to the addresses configured in
  `org_report_recipients` for category `incident`."
- "The action is retained in `public.ai_agent_actions` for 24 months in
  accordance with the customer's data retention configuration."

## 6. Failure-mode coverage

The **Troubleshooting** section covers, at minimum:

- The most common configuration error.
- The most common timing or race condition.
- The path to escalation if the procedure cannot complete.

Every entry names the symptom in bold, then states the remediation in one
or two declarative sentences. No paragraphs. No conditional speculation.

## 7. Reviewer's checklist

Before publishing a new or revised SOP:

- [ ] Frontmatter is complete and in the canonical order.
- [ ] All eight required sections are present and ordered correctly.
- [ ] No forbidden words or hedging language.
- [ ] Every UI element, path, RPC, table, column is in a code span.
- [ ] Verification steps are objective and self-service.
- [ ] At least three troubleshooting entries with named symptoms.
- [ ] Audit and compliance section names the specific audit table and any
      regulatory framing.
- [ ] Related procedures link to existing SOP slugs only.
- [ ] Reading time matches `estimated_minutes` within ±2 minutes.
- [ ] No internal slang. No exclamation marks. No emoji.

This file is not rendered in the catalogue (the underscore prefix is
excluded from the SOP glob). It is the authoring contract.
