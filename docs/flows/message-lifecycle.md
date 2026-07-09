# Message Lifecycle Flows

This document describes three critical message lifecycle flows in Geistr.
Understanding these is essential before making any changes to the send or
persistence paths.

---

## 1. Plain Text Message Lifecycle

This is the primary message path. It goes through a stable, tested sequence
that should not be changed without careful regression.

### Flow Diagram

```
Renderer                     Main Process                        Pi SDK
─────────                    ────────────                        ──────
User types text
    │
    ▼
Composer calls
window.geistr.sendMessage(text)
    │
    ▼
[IPC: geistr:send-message]
    │
    ▼
DesktopRuntimeBridge.sendMessage(text)
    │
    ├─ (1) Persist user message immediately via
    │   SessionPersistenceStore.appendMessage()
    │   → session_events (role=user)
    │
    ├─ (2) Start run UI timer
    │   → startRunUi() creates runUi state with runId, startedAt, status="running"
    │
    ├─ (3) Build prompt (no-attachment path):
    │   buildAttachmentPrompt(text, undefined) → { text }
    │
    ├─ (4) Call runtime.sendMessage(prompt.text)
    │   → maps to session.prompt(text)  [Pi SDK]
    │
    │   ┌────────────────────────────────────────────┐
    │   │ Pi AgentSession.prompt(text)               │
    │   │   └─ streams events:                       │
    │   │      message_start → text_delta* →         │
    │   │      tool_use* → message_end                │
    │   └────────────────────────────────────────────┘
    │              │
    │              ▼
    │   Runtime events flow to runtime.subscribe()
    │   → ingestRuntimeEvent(event)
    │
    │   For text_delta events:
    │     appendRunFinalText(delta) → runUi.finalText
    │
    │   For tool events:
    │     moveRunFinalTextToProgress() → draft text moved to runUi.progressItems
    │     appendRunToolSummary(toolName) → compact tool row
    │
    │   For thinking_delta:
    │     appendRunProgressText(delta) → runUi.progressItems
    │
    ├─ (5) After session.prompt() resolves:
    │   Read finalText from runUi
    │
    ├─ (6) If finalText.trim() has content AND
    │   no assistant event was persisted (pendingAssistantEventId === null):
    │
    │   Persist assistant message via
    │   SessionPersistenceStore.appendMessage()
    │   → session_events (role=assistant)
    │   → set pendingAssistantEventId
    │
    ├─ (7) Acknowledge pending loop results
    │
    ├─ (8) Reload messages from session store
    │
    ├─ (9) completeRunUi(finalText, "completed")
    │   → runUi.status = "completed", timer stops
    │
    ├─ (10) Schedule post-turn jobs (memory indexing, compaction)
    │
    └─ (11) Emit updated state to renderer
```

### Key invariants

1. **User message is persisted immediately** before the runtime starts, so it
   appears in the UI without waiting for the network.

2. **Assistant message is persisted only after `session.prompt()` resolves.**
   The bridge reads `runUi.finalText` and persists it as a single assistant
   `session_events` row with `role=assistant`. The `pendingAssistantEventId`
   guard ensures we never double-persist.

3. **Only the final assistant answer is persisted.** Thinking deltas, tool
   summaries, working narration, and progress text are runtime/UI-only in
   `runUi.progressItems`. They do not enter SQLite or future prompt context.

4. **If `session.prompt()` throws**, the error is caught by the outer
   try/catch block. `normalizeProviderError()` converts it to a user-friendly
   error message, which IS persisted as an assistant message with
   `metadata: { failed: true }` so the retry UI can work.

5. **After persist succeeds**, post-turn jobs run asynchronously in the
   background. Their errors are silently logged and never surface in chat.

---

## 2. Image / File Attachment Lifecycle

When the user attaches images or files to a message, the flow extends the
plain-text lifecycle at key points.

### Upload Flow (before send)

```
User clicks + button or pastes image
    │
    ▼
Renderer → IPC → DesktopRuntimeBridge
    │
    ▼
MediaManager saves file to app data:
  {mediaDir}/{sessionKey}/{id}_{safeName}
    │
    ├─ Upload: MediaManager.saveFile(sourcePath, fileName)
    │   → copies file, returns MessageAttachment { id, name, type, mimeType, size, path }
    │
    ├─ Paste: MediaManager.saveDataUrl(dataUrl, fileName)
    │   → decodes base64, writes file, returns MessageAttachment
    │
    ▼
For images specifically:
  MediaManager.writeAgentSafeImage()
    → creates compressed JPEG copy (max 768px, ~72 quality)
    → returns path to agent-safe copy
    → original path stored as originalPath if copy was made
    │
    ▼
Attachments stored in renderer state (not persisted until send)
    │
    ▼
Renderer shows:
  - Images: compact square thumbnails with remove button
  - Files: chip badges with remove button
```

### Send Flow (when user hits send)

```
sendMessage(text, attachments) called
    │
    ├─ No attachments → plain text path (flow 1 above)
    │
    ├─ Has attachments:
    │
    ▼
buildAttachmentPrompt(text, attachments)
    │
    ├─ Splits attachments into:
    │   files[] (non-image) and images[] (image type)
    │
    ├─ For each image:
    │   readFileSync(image.path) → base64
    │   → CoreAgentImageInput { type: "image", mimeType: "image/jpeg", data: "<base64>" }
    │
    ├─ Builds prompt notes:
    │   "Attached N image(s). Inspect the image input directly..."
    │   "Attached files: - name (path: ...) [file] ..."
    │
    ▼
Two cases:

A) Has images:
   runtime.sendMessage(prompt.text, { images: [...CoreAgentImageInput[]] })
   │   → maps to session.prompt(text, { images })  [Pi SDK native]
   │
   │   Important: Pi SDK's session.prompt() with images may resolve before
   │   the model has finished streaming the final answer.
   │
   ├─ Promise.race([
   │     runtime.sendMessage(..., { images }),
   │     waitForImagePromptFallback()
   │   ])
   │
   ├─ waitForImagePromptFallback() polls runUi.finalText:
   │   - If text is stable for 2.5s → resolve (answer likely complete)
   │   - If status becomes "Finishing" + non-empty text → resolve
   │   - If 60s timeout → resolve anyway (best-effort)
   │
   └─ Then follows same persist path as plain text (step 5+)

B) No images (file-only attachments):
   runtime.sendMessage(prompt.text)
   │   → same plain-text path
   │
   └─ Agent reads file paths via existing tools
```

### Key invariants

1. **Images are resized to 768px max side for sending**, then compressed to
   JPEG quality 72. The agent never sees the original resolution unless the
   bridge opens the original path. This saves tokens and respects the limited
   image context window.

2. **The image fallback (`waitForImagePromptFallback()`)** exists because Pi
   SDK's image-prompt promise can resolve before `message_end`. Without it,
   the assistant text would be empty/short and the final answer would be lost.
   The fallback polls `runUi.finalText` stability as a heuristic.

3. **Non-image file attachments** only provide file paths in the prompt text.
   The agent uses existing `read`/`bash` tools to inspect files. No special
   file content encoding is done for non-image attachments.

4. **Attachments are persisted as `session_events` metadata** (in the
   `payload_json` column) so they survive reload. Image thumbnails render
   from the stored paths using the `geistr-media://` Electron protocol.

### Important risk

The image fallback poll heuristic is inherently fragile. If the model streams
final text slowly (e.g. long thinking + short answer), the fallback may resolve
before the complete answer has arrived, or the stable-2.5s check may add
unnecessary delay. A more robust approach would use the Pi SDK's
`message_end` event as the completion signal, but the current SDK version does
not reliably fire it for image turns. Do not modify this code without testing
with real image+model combinations.

---

## 3. Run Finalization Lifecycle

### Why explicit persist is required

After `session.prompt()` resolves, the bridge **must explicitly persist** the
assistant message. This is not handled by event listeners or idle-time
callbacks. The pattern is intentional and critical.

### The bad alternatives (and why they fail)

| Approach | Why it fails |
|---|---|
| **Event-only persist**: persist on `message_end` event | `message_end` may fire before the SDK promise resolves, or may not fire at all for image prompts. The persist would happen at the wrong time or not at all. |
| **Idle-timer fallback**: save any unstored text after N seconds | Unpredictable timing. Could save partial text (if the user starts typing a follow-up), save empty text (if the model hasn't started), or save working-narration text that should not be a final message. Produces corrupted chat history. |
| **Autosave on session disposal**: save on `dispose()` | `dispose()` can be called during error recovery, abort, or runtime refresh — times when we explicitly do NOT want to persist partial/failed work. |

### The correct explicit persist flow

```
1. session.prompt(text) resolves (Promise fulfilled)
2. Bridge reads runUi.finalText
3. IF finalText.trim().length > 0 AND no event was already persisted:
     → sessionStore.appendMessage({ role: "assistant", content: finalText })
     → set pendingAssistantEventId guard
4. completeRunUi(finalText, "completed")
5. Schedule post-turn jobs
6. Emit state to renderer
```

### Error handling

If `session.prompt()` throws:

```
1. Catch block runs
2. normalizeProviderError() creates user-friendly error + technical details
3. assistant message persisted with:
   - content = normalized title
   - metadata.failed = true
   - metadata.errorKind = normalized kind
4. completeRunUi(normalized.title, "failed")
5. Renderer shows error card with:
   - Retry button → calls retryLastMessage()
   - Change model / Provider settings links
   - Show details / Copy details (collapsed)
```

### Why post-turn jobs are async and fire-and-forget

Post-turn jobs (memory indexing, compaction) run after persist but are not
awaited by the send flow. They're `void`-ed. This is intentional:

- The user should see the assistant response **immediately**, not wait for
  background maintenance.
- Post-turn job errors are logged to console and **never** surface as chat
  messages or visible errors.
- If a post-turn job fails, it will retry on the next turn (memory indexing
  waits for 50 unindexed messages; compaction checks after every turn).

### Run UI state lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   startRunUi()                                                  │
│     runId = randomUUID()                                        │
│     startedAt = now                                             │
│     status = "running"                                          │
│     elapsedMs = 0                                               │
│     progressItems = []                                          │
│     currentStatusLabel = "Thinking"                             │
│     finalText = ""                                              │
│     1s timer starts (updates elapsedMs)                         │
│                                                                 │
│   ← streamed text_delta events fill finalText                   │
│   ← tool/thinking events fill progressItems + status            │
│                                                                 │
│   completeRunUi(finalText, "completed")                         │
│     status = "completed"                                        │
│     timer cleared                                               │
│     currentStatusLabel = "Done"                                 │
│                                                                 │
│   On reload: runUi is null (only persisted messages shown)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Run UI state (`runUi`) is **never persisted**. It lives only in the
`DesktopRuntimeBridge` memory. On app reload:

- `runUi` = null
- Only SQLite `session_events` with `role=user` or `role=assistant` are shown
- No working logs, thinking text, or tool summaries survive reload
- This is by design — the session DB stays clean

### The pendingAssistantEventId guard

```
pendingAssistantEventId: string | null = null
```

This single field prevents double-persisting the assistant message:

- Set to `null` at the start of each `sendMessage()` call
- Set to the persisted event ID after `appendMessage()` succeeds for the assistant
- Checked before `appendMessage()`: if already set, skip
- Bridges the gap between the `runUi.finalText` capture and the SQLite append

Without this guard, a race between the normal persist path and an event-driven
or fallback persist path could create duplicate assistant messages.

### The per-run runtime refresh pattern

Before each assistant turn, the bridge calls `refreshRuntimeForNextRun()`:

```
refreshRuntimeForNextRun()
  1. Dispose old runtime (if exists)
  2. Dispose old MCP manager
  3. Create brand-new Pi AgentSession with:
     - Fresh profile/summary/memory/messages from DB
     - Current mode/permission config
     - Current active MCP server tools
     - Current active skills
  4. Subscribe to new runtime events
```

This means **every assistant turn gets a fresh Pi session**. This is necessary
because:

- Profiles, skills, MCP tools, and permissions can change between turns
- Pi sessions are single-turn by design for Geistr's architecture
- It ensures prompt context always reflects the latest state

However, it also means the runtime is disposable and any event subscriptions
from a previous turn are dead — hence the `activeForegroundRun` tracking to
properly handle stop/abort across refresh boundaries.

---

## Summary of Critical Rules

| Rule | Why |
|---|---|
| Persist user message BEFORE running the model | UI responsiveness, guarantees the user message exists even if the model call fails |
| Persist assistant message ONLY after session.prompt() resolves | Ensures complete answer, not partial/working text |
| Use pendingAssistantEventId to prevent double-persist | Race condition between normal path and event-driven path |
| runUi state is ephemeral, never persisted | Keeps session DB clean, prevents loading junk on reload |
| Post-turn jobs are fire-and-forget | User experience: don't wait for background maintenance |
| Image prompts need the fallback heuristic | Pi SDK image-prompt promise may resolve early |
| Refresh runtime before every turn | Ensures latest config, profile, skills, MCP, permissions |
| Error messages ARE persisted as assistant messages | Enables retry UI and error card on reload |
