import { FileText, X } from "lucide-react";
import type { MessageAttachment } from "@geistr/core";

function fileUrl(path: string): string {
  return `geistr-media://file?path=${encodeURIComponent(path)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="messageAttachments">
      {attachments.map((file) => file.type === "image" ? (
        <button className="messageImageAttachment" type="button" key={file.id} onClick={() => void window.geistr?.openPath(file.originalPath ?? file.path)} title={file.originalPath ?? file.path}>
          <img src={fileUrl(file.path)} alt={file.name} />
          <span>{file.name}</span>
        </button>
      ) : (
        <button className="messageFileAttachment" type="button" key={file.id} onClick={() => void window.geistr?.openPath(file.originalPath ?? file.path)} title={file.originalPath ?? file.path}>
          <FileText size={16} />
          <span>{file.name}</span>
          <small>{formatBytes(file.size)}</small>
        </button>
      ))}
    </div>
  );
}

export function PendingAttachments({ attachments, onRemove }: { attachments: MessageAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="pendingAttachments" aria-label="Pending attachments">
      {attachments.map((file) => file.type === "image" ? (
        <div className="pendingImageAttachment" key={file.id} title={file.path}>
          <img src={fileUrl(file.path)} alt={file.name} />
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="pendingAttachment" key={file.id} title={file.path}>
          <FileText size={14} />
          <span>{file.name}</span>
          <small>{formatBytes(file.size)}</small>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
