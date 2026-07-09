import { describe, expect, it } from "vitest";

import { assembleSystemPrompt } from "../src/index";

describe("assembleSystemPrompt", () => {
  it("assembles enabled sections in order using XML-like tags", () => {
    const prompt = assembleSystemPrompt({
      sections: [
        { tag: "identity", content: "You are Geistr's core personal agent." },
        { tag: "tools_policy", content: "Use the smallest sufficient tool set." }
      ]
    });

    expect(prompt).toBe(`<identity>\nYou are Geistr's core personal agent.\n</identity>\n\n<tools_policy>\nUse the smallest sufficient tool set.\n</tools_policy>`);
  });

  it("omits disabled and blank sections without leaving extra separators", () => {
    const prompt = assembleSystemPrompt({
      sections: [
        { tag: "identity", content: "Core agent" },
        { tag: "user_profile", content: "   " },
        { tag: "memory_scope", content: "Use only approved context.", enabled: false },
        { tag: "output_rules", content: "Be concise." }
      ]
    });

    expect(prompt).toBe("<identity>\nCore agent\n</identity>\n\n<output_rules>\nBe concise.\n</output_rules>");
  });

  it("places stable sections before dynamic sections to preserve prompt-cache-friendly structure", () => {
    const prompt = assembleSystemPrompt({
      stableSections: [{ tag: "identity", content: "Stable identity" }],
      dynamicSections: [{ tag: "task_context", content: "Changing task context" }]
    });

    expect(prompt).toBe("<identity>\nStable identity\n</identity>\n\n<task_context>\nChanging task context\n</task_context>");
  });

  it("rejects invalid section tags", () => {
    expect(() =>
      assembleSystemPrompt({
        sections: [{ tag: "bad tag", content: "No spaces in tags." }]
      })
    ).toThrow("Invalid system prompt section tag");
  });
});
