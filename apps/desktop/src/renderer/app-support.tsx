import { Check, LockKeyhole, Shield, ShieldCheck } from "lucide-react";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";

import type { AppConfigPermissionMode } from "@geistr/core";
import type { DesktopChatState, DesktopLoopProgress } from "../shared/desktop-api";

export function McpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24">
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
  );
}

export function PermissionModePicker({ mode, onSelect }: { mode: AppConfigPermissionMode; onSelect: (mode: AppConfigPermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && !anchorRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);
  const options: Array<{ mode: AppConfigPermissionMode; label: string; icon: typeof Shield }> = [
    { mode: "read-only", label: "Read only", icon: LockKeyhole },
    { mode: "ask-always", label: "Request approval", icon: Shield },
    { mode: "auto", label: "Default", icon: Shield },
    { mode: "full-access", label: "Full access", icon: ShieldCheck },
  ];
  const active = options.find((option) => option.mode === mode) ?? options.find((option) => option.mode === "auto")!;
  const Icon = active.icon;
  return (
    <div className="permissionMenuAnchor" ref={anchorRef}>
      <button className={`permissionAction permission-${mode}`} type="button" aria-label={`Permission mode: ${active.label}`} title={`Permission mode: ${active.label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon size={17} />
      </button>
      {open ? (
        <div className="permissionMenu" role="menu" aria-label="Permission mode options">
          {options.map((option) => {
            const OptionIcon = option.icon;
            const selected = option.mode === mode;
            return (
              <button key={option.mode} type="button" role="menuitemradio" aria-checked={selected} className={selected ? "permissionMenuItem selected" : "permissionMenuItem"} onClick={() => { onSelect(option.mode); setOpen(false); }}>
                <OptionIcon size={15} />
                <span>{option.label}</span>
                {selected ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorCard({ error, onRetry, onChangeModel, onProviderSettings }: { error: NonNullable<DesktopChatState["messages"][number]["error"]>; onRetry: () => void; onChangeModel: () => void; onProviderSettings: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="errorCard" role="alert" aria-label="Assistant error">
      <div className="errorCardHeader">
        <strong>{error.title}</strong>
        <span>{error.message}</span>
      </div>
      <div className="errorCardActions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onChangeModel}>Change model</button>
        <button type="button" onClick={onProviderSettings}>Provider settings</button>
        <button type="button" onClick={() => setShowDetails((value) => !value)}>{showDetails ? "Hide details" : "Show details"}</button>
        <button type="button" onClick={() => copyText(error.technicalDetails)}>Copy details</button>
      </div>
      {showDetails ? <pre className="errorDetails">{error.technicalDetails}</pre> : null}
    </div>
  );
}

export function ApprovalWidget({ approval, onResolve }: { approval: DesktopChatState["pendingApproval"]; onResolve: (id: string, approved: boolean) => void }) {
  if (!approval) return null;
  return (
    <div className="approvalWrap" role="alertdialog" aria-label="Tool approval required">
      <div className="approvalCard">
        <div className="approvalText">
          <strong>Approve {approval.toolName}?</strong>
          <span>{approval.action ?? approval.command ?? approval.path ?? "Tool action"}</span>
          <small>{approval.tier} · {approval.reason}</small>
        </div>
        <div className="approvalActions">
          <button type="button" onClick={() => onResolve(approval.id, false)}>Deny</button>
          <button type="button" className="approvalPrimary" onClick={() => onResolve(approval.id, true)}>Approve</button>
        </div>
      </div>
    </div>
  );
}

export function PlaceholderPage({ title, text }: { title: string; text: string }) {
  return (
    <div className="settingsStack">
      <header>
        <h2>{title}</h2>
        <p>{text}</p>
      </header>
      <div className="settingsCard settingsEmpty">No controls are available in this first pass.</div>
    </div>
  );
}

export function LoopProgressWidget({ progress }: { progress: DesktopLoopProgress | null }) {
  if (!progress || progress.status === "completed") return null;
  const stepLabel = progress.stepIndex && progress.totalSteps ? `Step ${progress.stepIndex}/${progress.totalSteps}` : "Running";
  const nodeLabel = progress.nodeLabel ?? progress.summary ?? "Working";
  return (
    <div className="loopProgressWrap" aria-live="polite">
      <div className="loopProgressCard">
        <span className="loopProgressPulse" />
        <div className="loopProgressText">
          <strong>{progress.loopLabel}</strong>
          <span>{stepLabel} · {nodeLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function getInitials(displayName?: string): string {
  if (!displayName || !displayName.trim()) return "U";
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0];
  if (!first) return "U";
  if (parts.length === 1) return first.charAt(0).toUpperCase();
  const last = parts[parts.length - 1];
  if (!last) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function visibleMessagesForRun(messages: DesktopChatState["messages"], runUi: DesktopChatState["runUi"]): DesktopChatState["messages"] {
  if (!runUi || runUi.status === "running") return messages.filter((message) => !message.isStreaming);
  const last = messages.at(-1);
  if (last?.role === "assistant" && !last.error && last.content === runUi.finalText) return messages.slice(0, -1);
  return messages.filter((message) => !message.isStreaming);
}

export function arraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function renderMarkdown(text: string): string {
  try {
    let html = marked.parse(escapeHtml(text), { async: false }) as string;
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>');
    return html;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard not available
  }
}