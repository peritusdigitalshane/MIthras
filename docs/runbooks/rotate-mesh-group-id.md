# Runbook — set and rotate the MeshCentral group id

**Action required after migration `20260909020000`.** Remote access
(`install_mesh_agent`) is inert until `platform_settings.mesh_group_id` is set.

## Why this changed

`agent/runtime-powershell/lib/CommandExecutor.psm1` carried the mesh group id
as a hardcoded default parameter value:

```powershell
$meshId = if ($Params.mesh_id) { ... } else { 'LHDBcLRoKOPD$Olt…' }
```

The console enqueues `install_mesh_agent` with **no params at all**, so that
default was the value used on every install. A MeshCentral group id is a
shared enrolment secret — holding it is enough to enrol a device into the
Mithras remote-control group. This one was:

- committed to git (present from commit `8b0049a` onward, and still in
  history), and
- shipped in cleartext inside the agent bundle to every customer endpoint.

Agent v0.7.21 removes the fallback entirely. The id now lives in
`platform_settings` and is served only to authenticated agents via
`agent-api GET /mesh-config`. It is deliberately **not** exposed to the web
console — putting it in the React bundle would be exactly as public as baking
it into the agent.

## Decide first: rotate, or restore then rotate

**Rotate now (recommended).** The old id is published. Create a new
MeshCentral device group, use its id, and retire the old group once existing
agents are migrated.

**Restore now, rotate later.** Set `mesh_group_id` to the current group's id.
This is no worse than the exposure that already exists, and it gets remote
access working immediately — but it leaves a known-published secret live.
Treat it as a stopgap with a date on it.

Either way, already-enrolled endpoints keep working: they are enrolled
already. This value only affects *new* `install_mesh_agent` runs.

## Steps

1. In MeshCentral, open **My Devices → (group) → Add Agent** and copy the
   mesh id from the install URL (`?meshid=...`, URL-decoded).

2. Set it:

   ```sql
   UPDATE public.platform_settings
      SET value = '<mesh id>', updated_at = now()
    WHERE key = 'mesh_group_id';
   ```

3. Confirm the server URL matches your deployment. It must also appear in
   `$script:AllowedMeshHosts` in `CommandExecutor.psm1` — the agent refuses to
   download a MeshCentral agent from any other host.

   ```sql
   SELECT key, value FROM public.platform_settings
    WHERE key IN ('mesh_group_id', 'mesh_server_url');
   ```

4. Test on one endpoint: **Endpoint detail → Remote access → Install**. Then
   on the box:

   ```powershell
   Get-Content C:\ProgramData\Mithras\logs\commands.log -Tail 20
   ```

## Failure modes

| Symptom | Cause |
|---|---|
| Command fails: `no mesh_id available` | `mesh_group_id` is empty. Do step 2 |
| `/mesh-config` returns 503 `mesh_group_id_not_configured` | Same, seen from the server side |
| Command fails: `refusing to download a MeshCentral agent from untrusted host` | `mesh_server_url` is not in `AllowedMeshHosts`. Add it and ship an agent release |
| Agent logs `mesh-config: no agent token available` | The endpoint has no cached legacy token yet; it resolves after a heartbeat |

## Cleaning up the old exposure

Rotating the id does not remove it from git history or from agent bundles
already on disk. It stops being useful once the old MeshCentral group is
deleted — do that once no device still reports into it. Deleting the group is
what actually revokes the secret; rotation alone only stops new use.
