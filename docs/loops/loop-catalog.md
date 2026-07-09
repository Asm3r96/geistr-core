# Loop Catalog and Agent Tools

Geistr exposes background loops to agents only through an approved catalog.

## Catalog entries

`@geistr/core` exports `LoopCatalog` and `LoopCatalogEntry`. Each entry declares:

- `loopId`, `label`, `description`
- `status`: `available`, `disabled`, or `internal-only`
- `inputSchema`
- `defaultMode`: `background` or `foreground`
- `requiresApproval`
- `allowedScopes`
- optional `maxEstimatedRuntimeMs`
- `resultPolicy`: `inline-small`, `artifact-required`, or `hidden-only`

Only entries with `status: "available"` and an allowed current scope are visible/startable through agent tools.

## Tools

The desktop runtime adds two custom tools:

- `loop_read`
- `loop_write`

`loop_read` actions:

- `list` — list available approved loops for the active agent scope.
- `get` — get details and the input contract for one loop.
- `status` — read progress/result references for a run.

`loop_write` actions:

- `start` — start an approved catalog loop.
- `cancel` — cancel a supported run.

The bridge infers the active `sessionKey`; model input cannot target arbitrary sessions.

## Start result

Starting a loop returns only a small result:

```json
{
  "started": true,
  "runId": "...",
  "loopId": "...",
  "status": "queued",
  "message": "... started",
  "resultDelivery": "same-session-wakeup"
}
```

Long results are delivered through hidden same-session loop result state and artifact IDs, not chat text.

## Initial entry

The first catalog entry is `session-compaction`, a safe session-management loop. It is cataloged and background-only; it writes hidden continuity state and reports completion through the same-session wake-up path.

By default, agent-started compaction uses the normal compaction threshold. Passing `{ "force": true }` in the tool input lowers the threshold for development/testing/manual maintenance. If no compaction is needed, the loop completes as a successful no-op with summary `No compaction needed`.
