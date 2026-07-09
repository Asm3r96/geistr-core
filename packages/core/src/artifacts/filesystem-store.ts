import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArtifactOwner, ArtifactRecord, ArtifactStore, PutFileArtifactInput, PutJsonArtifactInput, PutTextArtifactInput } from "./types";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FILE = "artifacts.json";
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization|credential)/i;

export interface FilesystemArtifactStoreOptions { rootDir: string; idFactory?: () => string; defaultTtlMs?: number; now?: () => number }

export class FilesystemArtifactStore implements ArtifactStore {
  private readonly idFactory: () => string;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: FilesystemArtifactStoreOptions) {
    mkdirSync(options.rootDir, { recursive: true });
    this.idFactory = options.idFactory ?? (() => `artifact_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  putText(input: PutTextArtifactInput): ArtifactRecord {
    const text = input.text;
    const bytes = Buffer.byteLength(text, "utf8");
    const record = this.makeRecord(input, input.kind ?? "text", input.mimeType ?? "text/plain; charset=utf-8", bytes, ".txt");
    writeFileSync(this.pathFor(record.storagePath), text, "utf8");
    this.saveRecord(record);
    return record;
  }

  putJson(input: PutJsonArtifactInput): ArtifactRecord {
    const text = JSON.stringify(input.value, null, 2);
    const bytes = Buffer.byteLength(text, "utf8");
    const record = this.makeRecord(input, input.kind ?? "json", input.mimeType ?? "application/json", bytes, ".json");
    writeFileSync(this.pathFor(record.storagePath), text, "utf8");
    this.saveRecord(record);
    return record;
  }

  putFile(input: PutFileArtifactInput): ArtifactRecord {
    const bytes = readFileSync(input.sourcePath).byteLength;
    const ext = basename(input.sourcePath).includes(".") ? `.${basename(input.sourcePath).split(".").pop()}` : ".bin";
    const record = this.makeRecord(input, input.kind ?? "file", input.mimeType ?? "application/octet-stream", bytes, ext);
    copyFileSync(input.sourcePath, this.pathFor(record.storagePath));
    this.saveRecord(record);
    return record;
  }

  getArtifact(id: string): ArtifactRecord | null { return this.records().find((record) => record.artifactId === id) ?? null; }

  readArtifactText(id: string, maxBytes = 128_000): string | null {
    const record = this.getArtifact(id);
    if (!record || record.byteLength > maxBytes || !record.mimeType.startsWith("text/") && record.mimeType !== "application/json") return null;
    return readFileSync(this.pathFor(record.storagePath), "utf8");
  }

  deleteExpiredArtifacts(now = this.now()): number {
    const kept: ArtifactRecord[] = [];
    let deleted = 0;
    for (const record of this.records()) {
      if (record.expiresAt !== null && record.expiresAt <= now) {
        rmSync(this.pathFor(record.storagePath), { force: true });
        deleted += 1;
      } else kept.push(record);
    }
    this.writeRecords(kept);
    return deleted;
  }

  listArtifactsForOwner(owner: ArtifactOwner): ArtifactRecord[] {
    return this.records().filter((record) => record.ownerType === owner.ownerType && record.ownerId === owner.ownerId && (!owner.sessionKey || record.sessionKey === owner.sessionKey) && (!owner.loopRunId || record.loopRunId === owner.loopRunId));
  }

  private makeRecord(input: PutTextArtifactInput | PutJsonArtifactInput | PutFileArtifactInput, kind: ArtifactRecord["kind"], mimeType: string, byteLength: number, ext: string): ArtifactRecord {
    const createdAt = input.now ?? this.now();
    const ttlMs = input.ttlMs === undefined ? this.defaultTtlMs : input.ttlMs;
    const artifactId = this.idFactory();
    return {
      artifactId,
      title: input.title,
      kind,
      mimeType,
      byteLength,
      storagePath: `${artifactId}${ext}`,
      createdAt,
      expiresAt: ttlMs === null ? null : createdAt + ttlMs,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      ...(input.loopRunId ? { loopRunId: input.loopRunId } : {}),
      visibility: input.visibility ?? "internal",
      metadata: sanitizeMetadata(input.metadata ?? {}),
    };
  }

  private pathFor(name: string): string { return join(this.options.rootDir, name); }
  private metadataPath(): string { return this.pathFor(METADATA_FILE); }
  private saveRecord(record: ArtifactRecord): void { this.writeRecords([...this.records().filter((item) => item.artifactId !== record.artifactId), record]); }
  private records(): ArtifactRecord[] {
    if (!existsSync(this.metadataPath())) return [];
    try { const parsed = JSON.parse(readFileSync(this.metadataPath(), "utf8")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  private writeRecords(records: ArtifactRecord[]): void { writeFileSync(this.metadataPath(), JSON.stringify(records, null, 2), "utf8"); }
}

export function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = typeof item === "object" && item !== null && !Array.isArray(item) ? sanitizeMetadata(item as Record<string, unknown>) : item;
  }
  return output;
}
