# Runtime tool permissions

Geistr has a runtime permission classifier for agent tool calls. The goal is app-driven approval for risky actions: the agent never fabricates approval and chat text is not a substitute for UI approval.

## Modes

- `read-only` — safe reads run automatically; file/shell mutation tools are not available; blocked actions are blocked.
- `ask-always` — shown as Request approval. Safe reads run automatically; Geistr-controlled file/shell mutation tools ask every time; blocked actions are blocked. Internal mutations may run only when marked as explicit user intent.
- `auto` — default. Safe reads and low-risk Geistr internal mutations run automatically; ordinary workspace file mutations are allowed; dangerous actions ask; blocked actions are blocked.
- `full-access` — safe/internal/file/dangerous actions run without prompts; blocked actions are still blocked.

`appConfig.permissions.mode` stores the current mode and defaults to `auto`.

## Tiers

- `safe`: profile, memory, loop, and workspace file reads.
- `internal_mutate`: profile, memory, and approved loop writes.
- `file_mutate`: file write/edit and shell commands that create, update, move, or remove files.
- `dangerous`: shell control, package install/update, git mutation, network commands, permission changes, and destructive database commands.
- `blocked`: obviously catastrophic commands such as `sudo`, `dd`, `mkfs`, shutdown/reboot, and recursive delete of root/home.

## Composer mode control

This slice keeps mode selection in the existing chat input controls. The composer shows only an icon beside the current model/thinking controls. Clicking it opens a three-option menu:

- Read only (`read-only`)
- Request approval (`ask-always`)
- Default (`auto`)
- Full access (`full-access`)

The active mode is indicated in the opened menu and may also be reflected by icon styling/tooltip. There is no separate Settings page and no custom mode option.

## Desktop approval flow

When a gated custom tool call needs approval, the main process publishes `DesktopChatState.pendingApproval`. The renderer shows an approval card with tool name, command/action/path, risk tier, reason, and Approve/Deny buttons. Execution pauses until `resolveToolApproval(id, approved)` is called.

Current slice gates Geistr custom tools (`profile_*`, `memory_*`, `loop_*`) and adds Geistr-controlled `file_write`, `file_edit`, and `shell_run` tools for Request approval mode. In Read only, file/shell mutation tools are removed. In `auto` and `full-access`, Pi built-in `read`, `write`, `edit`, and `bash` are still passed through Pi directly; if Pi does not expose approval hooks, Geistr should replace them with controlled wrappers before relying on prompts for built-in file/shell permissions in those modes.
