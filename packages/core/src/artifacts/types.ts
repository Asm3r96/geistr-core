export type ArtifactKind = "text" | "json" | "file" | "loop-result";
export type ArtifactOwnerType = "session" | "loop-run" | "app-agent";
export type ArtifactVisibility = "internal" | "user-visible";

export interface ArtifactOwner { ownerType: ArtifactOwnerType; ownerId: string; sessionKey?: string; loopRunId?: string }
export interface ArtifactRecord extends ArtifactOwner { artifactId: string; title: string; kind: ArtifactKind; mimeType: string; byteLength: number; storagePath: string; createdAt: number; expiresAt: number | null; visibility: ArtifactVisibility; metadata: Record<string, unknown> }
export interface PutArtifactBaseInput extends ArtifactOwner { title: string; kind?: ArtifactKind; mimeType?: string; ttlMs?: number | null; visibility?: ArtifactVisibility; metadata?: Record<string, unknown>; now?: number }
export interface PutTextArtifactInput extends PutArtifactBaseInput { text: string; kind?: "text" | "loop-result" }
export interface PutJsonArtifactInput extends PutArtifactBaseInput { value: unknown; kind?: "json" | "loop-result" }
export interface PutFileArtifactInput extends PutArtifactBaseInput { sourcePath: string; kind?: "file" }

export interface ArtifactStore {
  putText(input: PutTextArtifactInput): Promise<ArtifactRecord> | ArtifactRecord;
  putJson(input: PutJsonArtifactInput): Promise<ArtifactRecord> | ArtifactRecord;
  putFile(input: PutFileArtifactInput): Promise<ArtifactRecord> | ArtifactRecord;
  getArtifact(id: string): Promise<ArtifactRecord | null> | ArtifactRecord | null;
  readArtifactText(id: string, maxBytes?: number): Promise<string | null> | string | null;
  deleteExpiredArtifacts(now?: number): Promise<number> | number;
  listArtifactsForOwner(owner: ArtifactOwner): Promise<ArtifactRecord[]> | ArtifactRecord[];
}
