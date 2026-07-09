import { ChevronDown, ChevronRight, Copy, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";

import type { DesktopRunUiState } from "../shared/desktop-api";

export function RunTranscriptBlock({ run, renderMarkdown, copyText }: { run: DesktopRunUiState; renderMarkdown: (text: string) => string; copyText: (text: string) => void }) {
  const completed = run.status !== "running";
  const [expanded, setExpanded] = useState(!completed);

  useEffect(() => {
    setExpanded(!completed);
  }, [completed, run.runId]);

  return (
    <article className="message assistant runTranscriptBlock" aria-label={completed ? "Assistant response" : "Assistant working"}>
      <RunLogSummary run={run} expanded={expanded} onToggle={() => setExpanded((value) => !value)} renderMarkdown={renderMarkdown} />
      {run.finalText ? (
        <div className="finalAssistantMessage">
          <div className="messageContent" dangerouslySetInnerHTML={{ __html: renderMarkdown(run.finalText) }} />
          {completed ? (
            <div className="messageMeta">
              <span className="messageTime">Completed</span>
              <button className="copyButton" type="button" onClick={() => copyText(run.finalText ?? "")} aria-label="Copy message">
                <Copy size={14} />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function RunLogSummary({ run, expanded, onToggle, renderMarkdown }: { run: DesktopRunUiState; expanded: boolean; onToggle: () => void; renderMarkdown: (text: string) => string }) {
  const completed = run.status !== "running";
  const elapsedLabel = formatElapsed(completed ? "Worked" : "Working", run.elapsedMs);
  return (
    <section className={completed ? "runLogSummary completed" : "runLogSummary"}>
      <button className="runLogHeader" type="button" onClick={onToggle} aria-expanded={expanded}>
        {!completed ? <span className="runPulse" aria-hidden="true" /> : null}
        <strong>{elapsedLabel}</strong>
        {!completed && run.currentStatusLabel ? <span>{run.currentStatusLabel}</span> : null}
        <span className={expanded ? "runLogChevron expanded" : "runLogChevron"} aria-hidden="true">
          <ChevronRight size={15} />
        </span>
      </button>
      {expanded ? (
        <div className="runLogBody">
          {run.progressItems.length === 0 ? <RunStatusLine label={run.currentStatusLabel ?? "Thinking"} renderMarkdown={renderMarkdown} /> : null}
          {run.progressItems.map((item) => {
            if (item.type === "tool_summary") return <ToolSummaryRow key={item.id} label={item.label} details={item.details} />;
            if (item.type === "progress_text") return <RunStatusLine key={item.id} label={item.text} renderMarkdown={renderMarkdown} />;
            return <RunStatusLine key={item.id} label={item.label} renderMarkdown={renderMarkdown} />;
          })}
        </div>
      ) : null}
    </section>
  );
}

function ToolSummaryRow({ label, details }: { label: string; details: string[] | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(details?.length);
  return (
    <div className="toolSummaryGroup">
      <button className="toolSummaryRow" type="button" onClick={() => canExpand && setExpanded((value) => !value)} aria-expanded={canExpand ? expanded : undefined}>
        <SquareTerminal size={14} />
        <span>{label}</span>
      </button>
      {expanded && details?.length ? (
        <div className="toolDetailList">
          {details.map((detail, index) => <div className="toolDetailItem" key={`${detail}-${index}`}>{detail}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function RunStatusLine({ label, renderMarkdown }: { label: string; renderMarkdown: (text: string) => string }) {
  return <div className="runStatusLine" dangerouslySetInnerHTML={{ __html: renderMarkdown(label) }} />;
}

function formatElapsed(prefix: string, elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `${prefix} for ${seconds}s`;
}
