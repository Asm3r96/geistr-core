import { describe, expect, it } from "vitest";

import { extractRuntimeProviderFailure, runtimeMessageEndedSuccessfully } from "../main/runtime-bridge-utils";

describe("runtime provider failure extraction", () => {
  it("extracts non-throwing provider failures from assistant message_end events", () => {
    const error = extractRuntimeProviderFailure({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "insufficient_quota: You exceeded your current quota.",
      },
    });

    expect(error?.message).toContain("insufficient_quota");
  });

  it("extracts the final failed assistant message from agent_end events", () => {
    const error = extractRuntimeProviderFailure({
      type: "agent_end",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", stopReason: "error", errorMessage: "Monthly usage limit reached" },
      ],
    });

    expect(error?.message).toBe("Monthly usage limit reached");
  });

  it("recognizes successful assistant message_end events so stale retry errors can clear", () => {
    expect(runtimeMessageEndedSuccessfully({
      type: "message_end",
      message: { role: "assistant", stopReason: "end_turn" },
    })).toBe(true);
    expect(runtimeMessageEndedSuccessfully({
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "quota exceeded" },
    })).toBe(false);
  });

  it("does not overflow when provider failure events contain unsafe recursive fields", () => {
    const unsafeEvent = { type: "agent_end" } as Record<string, unknown>;
    Object.defineProperty(unsafeEvent, "errorMessage", {
      get() { throw new RangeError("Maximum call stack size exceeded"); },
    });
    Object.defineProperty(unsafeEvent, "message", {
      get() { throw new RangeError("Maximum call stack size exceeded"); },
    });
    Object.defineProperty(unsafeEvent, "messages", {
      get() { throw new RangeError("Maximum call stack size exceeded"); },
    });

    expect(extractRuntimeProviderFailure(unsafeEvent)?.message).toContain("could not be inspected safely");
    expect(runtimeMessageEndedSuccessfully(unsafeEvent)).toBe(false);
  });

  it("does not invoke recursive accessors while extracting provider failures", () => {
    const unsafeEvent = { type: "agent_end" } as Record<string, unknown>;
    Object.defineProperty(unsafeEvent, "errorMessage", {
      get() { return unsafeEvent.errorMessage; },
    });

    expect(extractRuntimeProviderFailure(unsafeEvent)?.message).toContain("could not be inspected safely");
  });
});
