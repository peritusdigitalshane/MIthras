---
title: Escalate a security concern
audience: customer_member
description: Who to contact and what info to bring when you notice something that looks wrong — without panicking the wider team.
order: 2
estimated_minutes: 4
updated_at: 2026-06-12
tags: escalation, comms, incident-response
---

## When to use this
- A coworker tells you something weird happened on their computer (unexpected popup, file gone, system slow, ransomware-looking message).
- You got a Mithras notification email you don't understand.
- A vendor email asks you to install software that "your IT provider approved" and you weren't told.
- You suspect the situation is too important for the chat channel.

You don't need to be sure. Better a false alarm than a delayed report.

## Steps

1. **Don't shut the machine down** unless someone with authority told you to. Important evidence is in memory.
2. **Don't click links** in the suspect email or popup. Just keep the screen open.
3. Go to **`/customer/contact`** — this shows your reseller's primary security contact (name, email, phone).
4. Use the phone number for anything urgent. Email for non-urgent.
5. Tell them, in this order:
   - **Who** noticed it (which staff member)
   - **What** they saw (the popup text, the file name, the email subject)
   - **When** it happened (rough time)
   - **What's running** on the machine right now (is it still on screen, did they click anything)
   - **What you've done** so far (told them to step away, took a photo, etc.)
6. Wait for instructions. **Don't take action that isn't asked for.**

## What your reseller can see
Once they know which endpoint is affected, they can:
- Open `/endpoints/<hostname>` and look at active threats, recent process activity, network connections.
- See if Mithras has already automatically blocked the threat.
- Trigger an **isolate network** action if needed (the laptop stays online for Mithras but is cut off from the LAN and Internet for everything else).

You don't need to do any of this — they have the tools.

## When to call Mithras direct (not your reseller)
Only if:
- Your reseller is unreachable AND
- The situation is genuinely time-critical (active ransomware encryption, mass account lockouts, financial-system breach)

The number on the contact page is Peritus 24/7 SOC. Use it sparingly — your reseller has the relationship history.

## After the smoke clears
- Your IT lead and reseller will agree on a write-up.
- The incident will appear in your next monthly report with a friendly summary.
- If it was a false alarm, that's a good outcome — well done for reporting.

## Related
- [Read your monthly Mithras report](/help/sops/customer_member/read-monthly-report)
