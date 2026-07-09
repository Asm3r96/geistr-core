# Provider Error Handling

Geistr normalizes model/provider failures before they cross into the renderer.

## Runtime contract

Core exposes `normalizeProviderError()` and the `NormalizedProviderError` shape:

- `kind` — one of `auth_required`, `invalid_api_key`, `rate_limited`, `quota_exceeded`, `model_unavailable`, `network`, `timeout`, `provider_error`, `tool_error`, or `unknown`.
- `title` / `message` — safe, user-facing copy for chat.
- `recoverable` — whether retry/settings/model actions make sense.
- `providerId` / `modelId` — optional context for recovery UI.
- `technicalDetails` — raw stack/SDK details for logs and explicit debugging only.

The desktop bridge catches foreground assistant-stream failures, logs `technicalDetails`, and emits a structured error message instead of raw thrown text.

Some Pi/provider failures do not reject `session.prompt()`. For example, account quota or usage-limit errors can arrive as terminal assistant events with `stopReason: "error"` and `errorMessage`, then the prompt promise resolves. The bridge treats those event-level failures the same as thrown errors: it normalizes them, shows a transient assistant error card, and marks the run UI as `failed` so the working transcript cannot stay stuck on `running` / `Finishing`.

Provider error cards are not persisted to the chat database. They are visible for the current UI state only, then disappear after reload or when reopening the chat. This prevents quota/auth/provider failures from becoming chat history, model context, compaction input, or memory-indexing input. Raw normalized error records are instead appended to the global runtime log file `runtime-workspace/logs/provider-errors.jsonl` under Electron `userData`.

## Renderer behavior

Chat renders current-session provider/runtime failures as a transient error card. The card shows friendly copy and actions:

- Retry
- Change model
- Provider settings
- Show details
- Copy details

Technical details are collapsed by default. Renderers should not parse stack traces or SDK strings to classify errors.

## Retry

`retryLastMessage()` reruns the latest user message without appending a duplicate user bubble. Failed error cards are removed from the transient UI before the retry starts.
