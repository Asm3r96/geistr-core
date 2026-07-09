import type { DesktopRunUiState } from "../shared/desktop-api";

export class RunUiManager {
  private elapsedTimer: NodeJS.Timeout | null = null;
  private runUi: DesktopRunUiState | null = null;

  constructor(private readonly onTick: () => void) {}

  getState(): DesktopRunUiState | null {
    return this.runUi;
  }

  start(): void {
    const now = Date.now();
    this.runUi = { runId: crypto.randomUUID(), startedAt: new Date(now).toISOString(), elapsedMs: 0, status: "running", progressItems: [], currentStatusLabel: "Thinking", finalText: "" };
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    this.elapsedTimer = setInterval(() => {
      if (!this.runUi || this.runUi.status !== "running") return;
      this.runUi = { ...this.runUi, elapsedMs: elapsedMs(this.runUi.startedAt) };
      this.onTick();
    }, 1000);
  }

  complete(finalText: string, status: DesktopRunUiState["status"]): void {
    if (!this.runUi) this.start();
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
    const current = this.runUi!;
    this.runUi = { ...current, status, finalText, elapsedMs: elapsedMs(current.startedAt), currentStatusLabel: status === "completed" ? "Done" : status };
  }

  setStatus(label: string): void {
    if (!this.runUi) return;
    this.runUi = { ...this.runUi, currentStatusLabel: label, elapsedMs: elapsedMs(this.runUi.startedAt) };
  }

  appendFinalText(delta: string): void {
    if (!this.runUi) return;
    this.runUi = { ...this.runUi, finalText: `${this.runUi.finalText ?? ""}${delta}`, elapsedMs: elapsedMs(this.runUi.startedAt) };
  }

  async waitForImagePromptFallback(): Promise<void> {
    await new Promise<void>((resolve) => {
      let lastText = "", stableSince = Date.now();
      const started = Date.now();
      const timer = setInterval(() => {
        const text = this.runUi?.finalText ?? "";
        if (text !== lastText) { lastText = text; stableSince = Date.now(); }
        const finishing = this.runUi?.currentStatusLabel === "Finishing" && text.trim().length > 0;
        const stable = text.trim().length > 0 && Date.now() - stableSince > 2_500;
        if (finishing || stable || Date.now() - started > 60_000) { clearInterval(timer); resolve(); }
      }, 250);
    });
  }

  appendProgressText(delta: string): void {
    if (!this.runUi) return;
    const text = delta.replace(/\s+/g, " ").trim();
    if (!text) return;
    const previous = this.runUi.progressItems.at(-1);
    const items = previous?.type === "progress_text"
      ? [...this.runUi.progressItems.slice(0, -1), { ...previous, text: `${previous.text} ${text}`.trim() }]
      : [...this.runUi.progressItems, { type: "progress_text" as const, id: crypto.randomUUID(), text }];
    this.runUi = { ...this.runUi, progressItems: items.slice(-12), elapsedMs: elapsedMs(this.runUi.startedAt) };
  }

  moveFinalTextToProgress(): void {
    const workingText = this.runUi?.finalText?.trim() ? this.runUi.finalText : "";
    if (!this.runUi || !workingText) return;
    this.runUi = { ...this.runUi, finalText: "" };
    this.appendProgressText(workingText);
  }

  appendToolSummary(toolName: string): void {
    if (!this.runUi) return;
    const cleanToolName = toolName.replace(/\s+/g, " ").trim() || "tool";
    const isCommandTool = /bash|shell|command|terminal/i.test(cleanToolName);
    const noun = isCommandTool ? "command" : "tool";
    const previous = this.runUi.progressItems.at(-1);
    if (previous?.type === "tool_summary") {
      const nextCount = (previous.count ?? 1) + 1;
      const label = `Ran ${nextCount} ${noun}s`;
      const updated = { ...previous, count: nextCount, label, details: [...(previous.details ?? []), cleanToolName].slice(-50) };
      this.runUi = { ...this.runUi, progressItems: [...this.runUi.progressItems.slice(0, -1), updated], elapsedMs: elapsedMs(this.runUi.startedAt) };
      return;
    }
    const label = `Ran 1 ${noun}`;
    this.runUi = { ...this.runUi, progressItems: [...this.runUi.progressItems, { type: "tool_summary" as const, id: crypto.randomUUID(), label, count: 1, details: [cleanToolName] }].slice(-12), elapsedMs: elapsedMs(this.runUi.startedAt) };
  }
}

function elapsedMs(startedAt: string): number {
  return Date.now() - Date.parse(startedAt);
}
