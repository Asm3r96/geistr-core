import { describe, expect, it } from "vitest";
import { InMemoryLoopStateStore, LoopRegistry, LoopRuntime, type LoopDefinition, type LoopEvent, type LoopModelRunner } from "../src";

function runtime(modelRunner?: LoopModelRunner) {
  const registry = new LoopRegistry();
  const events: LoopEvent[] = [];
  const rt = new LoopRuntime({ registry, ...(modelRunner ? { modelRunner } : {}), progressSink: { publish: (event) => events.push(event) }, idFactory: () => `run_${events.length}` });
  return { rt, registry, events };
}

const dummyLoop: LoopDefinition = {
  id: "dummy", version: "1.0.0", label: "Dummy", description: "Dummy loop",
  nodes: [
    { id: "prepare", kind: "code", label: "Prepare", goal: "Prepare", handlerId: "prepare" },
    { id: "gate", kind: "gate", label: "Gate", goal: "Validate", handlerId: "gate" },
    { id: "finish", kind: "finalizer", label: "Finish", goal: "Finish", handlerId: "finish" },
  ],
};

describe("LoopRuntime", () => {
  it("creates a run from a loop definition", () => {
    const { rt } = runtime();
    const run = rt.createRun(dummyLoop, { text: "hi" });
    expect(run.loopId).toBe("dummy");
    expect(run.currentNodeId).toBe("prepare");
    expect(Object.keys(run.nodeStates)).toEqual(["prepare", "gate", "finish"]);
  });

  it("runs code → gate → finalizer and stores artifacts", async () => {
    const { rt, registry } = runtime();
    registry.registerHandler("prepare", () => ({ summary: "prepared", artifacts: { clean: "context" } }));
    registry.registerHandler("gate", ({ artifacts }) => ({ summary: `saw ${artifacts.clean}`, verdict: "pass" }));
    registry.registerHandler("finish", () => ({ summary: "done", artifacts: { final: true } }));
    const run = await rt.start(dummyLoop);
    expect(run.status).toBe("completed");
    expect(run.artifacts).toMatchObject({ clean: "context", final: true });
  });

  it("runs single_request LLM nodes through a model runner", async () => {
    let prompt = "";
    const modelRunner: LoopModelRunner = { runSingleRequest: async (input) => { prompt = input.prompt; return { status: "completed", summary: "ok", artifacts: { answer: 42 } }; }, runAgentSession: async () => { throw new Error("unused"); } };
    const { rt } = runtime(modelRunner);
    const def: LoopDefinition = { id: "llm", version: "1", label: "LLM", description: "", nodes: [{ id: "ask", kind: "llm", mode: "single_request", label: "Ask", goal: "Answer", instruction: "Use facts" }] };
    const run = await rt.start(def);
    expect(run.status).toBe("completed");
    expect(run.artifacts.answer).toBe(42);
    expect(prompt).toContain("Use facts");
  });

  it("runs agent_session LLM nodes through a model runner", async () => {
    let called = false;
    const modelRunner: LoopModelRunner = { runSingleRequest: async () => { throw new Error("unused"); }, runAgentSession: async () => { called = true; return { status: "completed", summary: "agent", artifacts: { report: "ok" } }; } };
    const { rt } = runtime(modelRunner);
    const run = await rt.start({ id: "agent", version: "1", label: "Agent", description: "", nodes: [{ id: "work", kind: "llm", mode: "agent_session", label: "Work", goal: "Work" }] });
    expect(called).toBe(true);
    expect(run.artifacts.report).toBe("ok");
  });

  it("validates output with a validator", async () => {
    const { rt, registry } = runtime();
    registry.registerHandler("make", () => ({ summary: "made", artifacts: { value: 1 } }));
    registry.registerValidator("mustBeTwo", (_ctx, result) => ({ ...result, status: "failed", summary: "not two" }));
    const run = await rt.start({ id: "v", version: "1", label: "V", description: "", nodes: [{ id: "make", kind: "code", label: "Make", goal: "Make", handlerId: "make", validatorId: "mustBeTwo", retryPolicy: { maxAttempts: 1 } }] });
    expect(run.status).toBe("failed");
  });

  it("retries correctable failures and can route to needs_attention", async () => {
    const { rt, registry } = runtime();
    let attempts = 0;
    registry.registerHandler("flaky", () => { attempts += 1; return attempts < 2 ? { status: "failed", summary: "try again" } : { summary: "ok" }; });
    let run = await rt.start({ id: "retry", version: "1", label: "Retry", description: "", nodes: [{ id: "flaky", kind: "code", label: "Flaky", goal: "", handlerId: "flaky", retryPolicy: { maxAttempts: 2 } }] });
    expect(run.status).toBe("completed");
    expect(attempts).toBe(2);

    const r2 = runtime();
    r2.registry.registerHandler("bad", () => ({ status: "failed", summary: "bad" }));
    run = await r2.rt.start({ id: "attention", version: "1", label: "Attention", description: "", nodes: [{ id: "bad", kind: "code", label: "Bad", goal: "", handlerId: "bad", retryPolicy: { maxAttempts: 1, onExhausted: "needs_attention" } }] });
    expect(run.status).toBe("needs_attention");
  });

  it("honors transition retry and previous targets", async () => {
    const retryCase = runtime();
    let gateAttempts = 0;
    retryCase.registry.registerHandler("gate", () => ({ summary: "check", verdict: gateAttempts++ === 0 ? "correctable" : "pass" }));
    let run = await retryCase.rt.start({
      id: "transition-retry", version: "1", label: "Transition Retry", description: "",
      nodes: [{ id: "gate", kind: "gate", label: "Gate", goal: "", handlerId: "gate", retryPolicy: { maxAttempts: 2 } }],
      transitions: [
        { from: "gate", verdict: "correctable", target: { type: "retry" } },
        { from: "gate", verdict: "pass", target: { type: "complete" } },
      ],
    });
    expect(run.status).toBe("completed");
    expect(gateAttempts).toBe(2);

    const previousCase = runtime();
    let prepareAttempts = 0;
    previousCase.registry.registerHandler("prepare", () => ({ summary: "prepared", artifacts: { prepareAttempts: ++prepareAttempts } }));
    previousCase.registry.registerHandler("review", () => ({ summary: "review", verdict: prepareAttempts === 1 ? "correctable" : "pass" }));
    run = await previousCase.rt.start({
      id: "transition-previous", version: "1", label: "Transition Previous", description: "",
      nodes: [
        { id: "prepare", kind: "code", label: "Prepare", goal: "", handlerId: "prepare" },
        { id: "review", kind: "gate", label: "Review", goal: "", handlerId: "review" },
      ],
      transitions: [
        { from: "review", verdict: "correctable", target: { type: "previous" } },
        { from: "review", verdict: "pass", target: { type: "complete" } },
      ],
    });
    expect(run.status).toBe("completed");
    expect(prepareAttempts).toBe(2);
  });

  it("cleans context between LLM nodes by passing only selected artifacts", async () => {
    const seen: Record<string, unknown>[] = [];
    const modelRunner: LoopModelRunner = { runSingleRequest: async (input) => { seen.push(input.artifacts); return { status: "completed", summary: "ok", artifacts: input.node.id === "one" ? { accepted: "yes", noisyToolLog: "secret" } : { final: true } }; }, runAgentSession: async () => { throw new Error("unused"); } };
    const { rt } = runtime(modelRunner);
    const run = await rt.start({ id: "clean", version: "1", label: "Clean", description: "", nodes: [
      { id: "one", kind: "llm", label: "One", goal: "", inputArtifacts: [] },
      { id: "two", kind: "llm", label: "Two", goal: "", inputArtifacts: [{ key: "accepted" }] },
    ] });
    expect(run.status).toBe("completed");
    expect(seen[1]).toEqual({ accepted: "yes" });
  });

  it("emits progress events, fails unsupported nodes safely, and records steering", async () => {
    const { rt, events } = runtime();
    let run = await rt.start({ id: "badkind", version: "1", label: "BadKind", description: "", nodes: [{ id: "approval", kind: "approval", label: "Approval", goal: "" }] });
    expect(run.status).toBe("failed");
    expect(events.map((event) => event.type)).toContain("loop.node.failed");

    const steered = runtime({ runSingleRequest: async () => ({ status: "completed", summary: "ok" }), runAgentSession: async () => ({ status: "completed", summary: "ok" }), steer: async () => undefined });
    run = await steered.rt.start({ id: "steer", version: "1", label: "Steer", description: "", nodes: [{ id: "s", kind: "llm", label: "S", goal: "", steeringRules: [{ trigger: { type: "stalled", idleMs: 0 }, message: "report progress" }] }] });
    expect(run.evidence.some((item) => item.message === "report progress")).toBe(true);
    expect(steered.events.map((event) => event.type)).toContain("loop.steered");
  });

  it("persists state in memory store", async () => {
    const store = new InMemoryLoopStateStore();
    const rt = new LoopRuntime({ stateStore: store, idFactory: () => "persisted" });
    const run = rt.createRun(dummyLoop);
    expect(store.load(run.id)?.loopId).toBe("dummy");
  });
});
