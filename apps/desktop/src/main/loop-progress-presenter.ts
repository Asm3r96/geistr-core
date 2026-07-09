import type { LoopEvent } from "@geistr/core";
import type { DesktopLoopProgress } from "../shared/desktop-api";

export interface LoopProgressPresenterState {
  loopProgress: DesktopLoopProgress | null;
  clearTimer: NodeJS.Timeout | null;
}

export function publishLoopProgressState(
  state: LoopProgressPresenterState,
  event: LoopEvent,
  emit: () => void,
): void {
  if (state.clearTimer) {
    clearTimeout(state.clearTimer);
    state.clearTimer = null;
  }
  state.loopProgress = {
    runId: event.runId,
    loopId: event.loopId,
    loopLabel: event.loopLabel,
    status: event.status,
    ...(event.nodeLabel ? { nodeLabel: event.nodeLabel } : {}),
    ...(event.stepIndex ? { stepIndex: event.stepIndex } : {}),
    ...(event.totalSteps ? { totalSteps: event.totalSteps } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    updatedAt: event.timestamp,
  };
  emit();
  if (event.type === "loop.completed" || event.type === "loop.failed" || event.type === "loop.cancelled") {
    const runId = event.runId;
    state.clearTimer = setTimeout(() => {
      if (state.loopProgress?.runId === runId) {
        state.loopProgress = null;
        emit();
      }
      state.clearTimer = null;
    }, 5_000);
  }
}
