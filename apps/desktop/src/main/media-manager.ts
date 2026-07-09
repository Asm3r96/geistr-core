import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { nativeImage } from "electron";
import type { MessageAttachment } from "@geistr/core";

// ---------------------------------------------------------------------------
// Media Manager
//
// Manages file uploads and pasted images in the app data directory.
// Files are stored under: {mediaDir}/{sessionKey}/{timestamp}-{name}
// ---------------------------------------------------------------------------

export interface MediaFileRecord {
  sessionKey: string;
  id: string;
  name: string;
  type: "image" | "file";
  mimeType: string;
  size: number;
  path: string;
  createdAt: number;
}

function createId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}_${random}`;
}

/** Sanitize a filename for safe filesystem storage */
function sanitizeName(name: string): string {
  // Remove path separators and null bytes, limit length
  const safe = name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 120);
  // Keep extension
  const ext = extname(name).slice(0, 20);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  return `${base.slice(0, 100)}${ext}`;
}

/** Guess MIME type from extension */
function guessMimeType(name: string, fallback = "application/octet-stream"): string {
  const ext = extname(name).toLowerCase();
  const mime: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".xml": "application/xml",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".py": "text/x-python",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return mime[ext] ?? fallback;
}

function isImageType(mime: string): boolean {
  return mime.startsWith("image/");
}

export class MediaManager {
  constructor(private readonly mediaDir: string) {}

  /** Ensure the base media directory exists */
  ensureReady(): void {
    if (!existsSync(this.mediaDir)) {
      mkdirSync(this.mediaDir, { recursive: true });
    }
  }

  /** Get the session media directory path */
  private sessionDir(sessionKey: string): string {
    // Sanitize session key for directory name
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.mediaDir, safeKey);
  }

  /** Create session directory if needed */
  private ensureSessionDir(sessionKey: string): string {
    const dir = this.sessionDir(sessionKey);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  saveFile(sessionKey: string, sourcePath: string, fileName?: string): MessageAttachment {
    const dir = this.ensureSessionDir(sessionKey);
    const originalName = fileName ?? basename(sourcePath);
    const id = createId();
    const destPath = join(dir, `${id}_${sanitizeName(originalName)}`);
    copyFileSync(sourcePath, destPath);
    const mime = guessMimeType(originalName);
    if (!isImageType(mime)) return { id, name: originalName, type: "file", mimeType: mime, size: statSync(destPath).size, path: destPath };
    const agentPath = this.writeAgentSafeImage(destPath, dir, id) ?? destPath;
    return { id, name: originalName, type: "image", mimeType: "image/jpeg", size: statSync(agentPath).size, path: agentPath, ...(agentPath !== destPath ? { originalPath: destPath } : {}) };
  }

  /**
   * Save a data URL (e.g. from paste) as a file in the session's media directory.
   * Supports: data:image/png;base64,... and data:application/pdf;base64,...
   */
  saveDataUrl(sessionKey: string, dataUrl: string, fileName: string): MessageAttachment {
    const mimeMatch = dataUrl.match(/^data:([^;]+);/);
    const mime = mimeMatch?.[1] ?? "application/octet-stream";
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");

    const dir = this.ensureSessionDir(sessionKey);
    const id = createId();
    // Append correct extension based on mime
    const extMap: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/bmp": ".bmp",
      "image/svg+xml": ".svg",
    };
    const ext = extname(fileName) || extMap[mime] || "";
    const storedName = `${id}_${sanitizeName(fileName || `pasted${ext}`)}`;
    const destPath = join(dir, storedName);

    writeFileSync(destPath, buffer);
    if (!isImageType(mime)) return { id, name: fileName, type: "file", mimeType: mime, size: buffer.length, path: destPath };
    const agentPath = this.writeAgentSafeImage(destPath, dir, id) ?? destPath;
    return { id, name: fileName, type: "image", mimeType: "image/jpeg", size: statSync(agentPath).size, path: agentPath, ...(agentPath !== destPath ? { originalPath: destPath } : {}) };
  }

  private writeAgentSafeImage(sourcePath: string, dir: string, id: string): string | null {
    try {
      const image = nativeImage.createFromPath(sourcePath);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      const maxSide = 768;
      const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
      const safe = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" }) : image;
      const dest = join(dir, `${id}_agent-safe.jpg`);
      writeFileSync(dest, safe.toJPEG(72));
      return dest;
    } catch { return null; }
  }

  /** Delete a media file by its absolute path */
  delete(path: string): boolean {
    try {
      if (existsSync(path) && statSync(path).isFile()) {
        unlinkSync(path);
        return true;
      }
    } catch {
      // File already gone or inaccessible
    }
    return false;
  }

  /** List all media files for a session */
  listSession(sessionKey: string): MediaFileRecord[] {
    const dir = this.sessionDir(sessionKey);
    if (!existsSync(dir)) return [];
    return this.readDir(dir, sessionKey);
  }

  /** List all media across all sessions */
  listAll(): MediaFileRecord[] {
    if (!existsSync(this.mediaDir)) return [];
    const sessions = readdirSync(this.mediaDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const all: MediaFileRecord[] = [];
    for (const sessionKey of sessions) {
      const dir = join(this.mediaDir, sessionKey);
      all.push(...this.readDir(dir, sessionKey));
    }
    return all;
  }

  /** Read a directory and return records */
  private readDir(dir: string, sessionKey: string): MediaFileRecord[] {
    try {
      const files = readdirSync(dir);
      return files
        .map((name) => {
          const fullPath = join(dir, name);
          try {
            const stats = statSync(fullPath);
            if (!stats.isFile()) return null;
            // Extract id from stored name (format: {id}_{name})
            const underscoreIdx = name.indexOf("_");
            const id = underscoreIdx > 0 ? name.slice(0, underscoreIdx) : name;
            // Original name is the rest after id_
            const originalName = underscoreIdx > 0 ? name.slice(underscoreIdx + 1) : name;
            const mime = guessMimeType(name);
            return {
              sessionKey,
              id,
              name: originalName,
              type: isImageType(mime) ? "image" : "file",
              mimeType: mime,
              size: stats.size,
              path: fullPath,
              createdAt: stats.birthtimeMs || stats.ctimeMs || 0,
            } as MediaFileRecord;
          } catch {
            return null;
          }
        })
        .filter((r): r is MediaFileRecord => r !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /** Get storage statistics */
  getStats(): { totalSize: number; fileCount: number } {
    const all = this.listAll();
    return {
      totalSize: all.reduce((sum, f) => sum + f.size, 0),
      fileCount: all.length,
    };
  }

  /** Build a file:// URL for local rendering */
  getFileUrl(filePath: string): string {
    return `file://${filePath.replace(/\\/g, "/")}`;
  }

  /** Read file contents as text (for agent use) */
  readFileText(filePath: string): string | null {
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }
}
