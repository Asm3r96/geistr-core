# Permissions and Access Modes

This document explains the permission system: the three access modes, what each mode allows, and how tool approval works.

## The three modes

The user can select the permission mode from a small icon beside the chat composer.

### 1. Read Only

In Read Only mode, you can read safe context but most mutations require approval.

| Action type | Behavior |
|-------------|----------|
| Read profile, memory, skills, loops | ✅ Allow automatically |
| Read files | ✅ Allow automatically |
| Update profile or memory | ❌ Requires approval |
| Write or edit files | ❌ Requires approval |
| Run shell commands | ❌ Requires approval |
| Network / internet access | ❌ Requires approval |
| Destructive commands (sudo, recursive rm) | 🚫 Blocked |

### 2. Default (recommended)

In Default mode, you can work freely inside the app boundary. Mutations outside the boundary or dangerous actions require approval.

| Action type | Behavior |
|-------------|----------|
| Read profile, memory, skills, loops | ✅ Allow automatically |
| Read files | ✅ Allow automatically |
| Update profile or memory (when user explicitly asks) | ✅ Allow automatically |
| Write or edit files inside allowed workspace | ✅ Allow automatically |
| Write or edit files outside workspace | ❌ Requires approval |
| Run safe shell commands | ✅ Allow automatically |
| Dangerous shell (package install, git push, network) | ❌ Requires approval |
| Internet / network access | ❌ Requires approval |
| Destructive commands | 🚫 Blocked |

### 3. Full Access

In Full Access mode, all normal actions proceed without approval prompts.

| Action type | Behavior |
|-------------|----------|
| All safe reads | ✅ Allow automatically |
| All profile/memory/file writes | ✅ Allow automatically |
| All shell commands (non-blocked) | ✅ Allow automatically |
| Network / internet access | ✅ Allow automatically |
| Destructive commands (sudo, forced recursive removal) | 🚫 Still blocked |

Full Access still blocks obviously catastrophic commands. It does not give blind trust for everything.

## How approval works

When a tool requires approval:

1. The runtime pauses the tool call
2. The app UI shows an approval card with:
   - Tool name
   - Action / command / path
   - Risk tier
   - Reason
   - Approve / Deny buttons
3. The user clicks Approve or Deny
4. If approved, the tool runs and returns its result to you
5. If denied, the tool returns an error that you should handle gracefully

**Important rules for you:**

- Do not ask the user to approve in chat as a substitute for the UI approval flow
- Do not claim a tool succeeded if it was denied
- Do not try to bypass approval by using a different tool for the same effect
- Handle denial gracefully: explain what was denied and why, suggest alternatives
- If a tool times out waiting for approval, it may return a timeout error — handle it naturally

## Blocked actions

Some actions are always blocked regardless of mode:

- `sudo` commands
- Recursive forced removal (`rm -rf /`, `rm -rf /*`)
- Filesystem formatting (`mkfs`, `dd` to block devices)
- Any command that could destroy the system or user data

These cannot be approved by the user. If you try one, it will return an error. Do not suggest blocked commands.

## Permission tiers reference

| Tier | Description | Examples |
|------|-------------|---------|
| Safe | Read-only, no risk | profile_read, memory_read, skill_load, loop_read, reading files |
| Internal_mutate | Modifies internal app state | profile_write, memory_write, loop_write |
| Workspace_mutate | Creates or changes files | file_write, file_edit, safe shell mutations |
| Dangerous | Network, package changes, git mutations | curl, wget, npm install, git push, ssh |
| Blocked | System-destructive | sudo, recursive forced rm, mkfs, dd |
