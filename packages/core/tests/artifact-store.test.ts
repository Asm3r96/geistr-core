import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FilesystemArtifactStore } from "../src/artifacts";

function tempStore() {
  let counter = 0;
  return new FilesystemArtifactStore({ rootDir: mkdtempSync(join(tmpdir(), "geistr-artifacts-")), idFactory: () => `artifact_${++counter}`, now: () => 1_000 });
}

describe("FilesystemArtifactStore", () => {
  it("writes and reads text/json/file artifact metadata", () => {
    const store = tempStore();
    const text = store.putText({ title: "Notes", text: "hello", ownerType: "session", ownerId: "s1", sessionKey: "s1" });
    const json = store.putJson({ title: "Data", value: { ok: true }, ownerType: "loop-run", ownerId: "r1", loopRunId: "r1" });
    const source = join(mkdtempSync(join(tmpdir(), "geistr-source-")), "file.txt");
    writeFileSync(source, "file-body", "utf8");
    const file = store.putFile({ title: "File", sourcePath: source, ownerType: "session", ownerId: "s1" });
    expect(text.byteLength).toBe(5);
    expect(json.mimeType).toBe("application/json");
    expect(file.kind).toBe("file");
    expect(store.readArtifactText(text.artifactId)).toBe("hello");
    expect(store.readArtifactText(json.artifactId)).toContain('"ok": true');
  });

  it("limits oversized inline reads and lists by owner", () => {
    const store = tempStore();
    const record = store.putText({ title: "Long", text: "abcdef", ownerType: "session", ownerId: "s1" });
    expect(store.readArtifactText(record.artifactId, 3)).toBeNull();
    expect(store.listArtifactsForOwner({ ownerType: "session", ownerId: "s1" })).toHaveLength(1);
  });

  it("deletes expired artifacts and preserves unexpired artifacts", () => {
    const store = tempStore();
    const expired = store.putText({ title: "Old", text: "old", ownerType: "session", ownerId: "s1", ttlMs: 10 });
    const kept = store.putText({ title: "Keep", text: "new", ownerType: "session", ownerId: "s1", ttlMs: 10_000 });
    expect(store.deleteExpiredArtifacts(1_020)).toBe(1);
    expect(store.getArtifact(expired.artifactId)).toBeNull();
    expect(store.getArtifact(kept.artifactId)).not.toBeNull();
  });

  it("removes secret-looking metadata keys", () => {
    const store = tempStore();
    const record = store.putText({ title: "Safe", text: "x", ownerType: "session", ownerId: "s1", metadata: { apiKey: "no", nested: { token: "no", ok: "yes" } } });
    expect(record.metadata).toEqual({ nested: { ok: "yes" } });
  });
});
