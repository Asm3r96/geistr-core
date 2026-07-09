# Artifact Store

Geistr core provides a reusable artifact/temp file store for loop outputs and future document/research/memory workflows.

## Core API

`@geistr/core` exports:

- `ArtifactStore`
- `FilesystemArtifactStore`
- artifact record/input types

Supported operations:

- `putText(input)`
- `putJson(input)`
- `putFile(input)`
- `getArtifact(id)`
- `readArtifactText(id, maxBytes?)`
- `deleteExpiredArtifacts(now?)`
- `listArtifactsForOwner(owner)`

## Records

Artifact records include:

- `artifactId`, `title`, `kind`, `mimeType`, `byteLength`
- `storagePath`
- `createdAt`, `expiresAt`
- owner fields: `ownerType`, `ownerId`, optional `sessionKey`, optional `loopRunId`
- `visibility`: `internal` or `user-visible`
- sanitized `metadata`

## Desktop storage

The desktop bridge creates a filesystem store under the runtime workspace:

- `runtime-artifacts/`

The current implementation keeps metadata in an `artifacts.json` file beside artifact content. The core interface is storage-agnostic, so SQLite metadata can replace or back this later without changing callers.

## Safety rules

- Long loop outputs should be saved as artifact references, not injected into chat context.
- `readArtifactText` returns `null` when an artifact exceeds the caller's `maxBytes`.
- Secret-looking metadata keys (`apiKey`, `token`, `password`, `secret`, etc.) are stripped before persistence.
- Artifacts have TTL by default and can be removed with `deleteExpiredArtifacts`.
