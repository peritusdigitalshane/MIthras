# EDR — See every process

**Target length:** 72 seconds
**Slug:** `sysmon-process-tree`

## Setup

1. CMW-TS1 has Sysmon installed and reporting events
2. Have `/telemetry` open with a few hundred events visible
3. Pre-stage at least one "interesting" event (a powershell.exe with a long
   command line works well for the demo). You can generate one with:
   `powershell -enc <base64>` then refresh.

## Shot list & voiceover

### [00:00 – 00:08]
**SHOW:** Telemetry page with summary cards lit up — Total (24h), Process,
Network, Endpoints.

**SAY:** "Mithras installs Sysmon on every endpoint with a tuned
configuration. You get process creates, network connects, and file creates
streaming into the platform every five minutes."

### [00:08 – 00:18]
**SHOW:** Use the event-type filter dropdown to flip between Process,
Network, File. Then type in the search box — "powershell" — events
filter live.

**SAY:** "The Process Telemetry view shows the entire fleet's activity.
Filter by event type, search by command line, hash, image, or destination
IP."

### [00:18 – 00:30]
**SHOW:** Hover over a couple of rows. The one-liner cell shows the
image, parent, command line snippet. Mouse over the small "Detail" button
on a row.

**SAY:** "Each row tells you the parent process, the user, the integrity
level, the destination of any network connection, and the SHA256 hash of
the binary."

### [00:30 – 00:42]
**SHOW:** Click "Detail" on a powershell.exe row. The detail dialog opens
showing every field — image, command line, parent image, integrity, the
hashes block at the bottom.

**SAY:** "When something stands out — say a powershell child of Word —
click into it. You'll see the full command line, the encoded payload, and
any outbound connections from the same process."

### [00:42 – 00:54]
**SHOW:** Highlight the SHA256 in the detail dialog. Cut to a Threat Hunting
view (if available) showing the IOC library — paste the hash in. Cut back
to telemetry with an alert badge.

**SAY:** "Drop the SHA256 into the IOC library and the next time it shows
up anywhere in your fleet, you get an alert."

### [00:54 – 01:12]
**SHOW:** Pan back to telemetry. Mouse over the time-window indicator.
Briefly cut to a terminal showing the `sysmon_events_2026_05` partition
table or just trust the visual.

**SAY:** "Telemetry retention defaults to ninety days on partitioned
tables. Indexes are tuned for the queries an analyst actually runs — by
hash, by destination, by image path."

### END

Optional outro: cut to landing hero, CTA.
