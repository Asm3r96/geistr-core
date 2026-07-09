import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SkillRegistry, createSkillToolDefinitions } from "../src/skills";
import { buildRuntimePrompt } from "../src/runtime-prompt";
import { classifyToolPermission } from "../src/tool-permissions";

function basePromptInput(activeSkillCatalog: string[]) {
  return {
    assistantProfile: {
      assistantName: "Geistr",
      personaSummary: "Helpful assistant",
      tone: "calm",
      communicationStyle: "direct",
      soulPrompt: "",
      rolePrompt: "",
      stylePrompt: "",
      boundaryPrompt: "",
      memoryPrompt: "",
      responseDepth: "balanced",
      warmth: "warm",
      directness: "direct",
      agentBehaviorNotesJson: "[]",
    },
    userProfile: {
      displayName: "Mohammed",
      locale: "en-US",
      languagePreferences: "English",
      learningStyle: "",
      activeGoals: "",
      preferences: "",
      constraints: "",
    },
    memoryContext: [],
    sessionSummary: null,
    recentMessages: [],
    activeSkillCatalog,
    runtimeClock: null,
    timezone: "UTC",
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("skill registry", () => {
  test("catalog includes writing-great-skills", () => {
    const entries = new SkillRegistry().list();
    expect(entries).toContainEqual({
      name: "writing-great-skills",
      description: "Reference for writing and editing skills well — the vocabulary and principles that make a skill predictable.",
      source: "builtin",
    });
  });

  test("runtime prompt lists compact catalog only", () => {
    const registry = new SkillRegistry();
    const catalog = registry.list().map((entry) => `${entry.name}: ${entry.description}`);
    const prompt = buildRuntimePrompt(basePromptInput(catalog)).systemInstruction;

    expect(prompt).toContain("writing-great-skills: Reference for writing and editing skills well");
    expect(prompt).not.toContain("A skill exists to wrangle determinism out of a stochastic system");
    expect(prompt).not.toContain("# Glossary — Building Great Skills");
  });

  test("lists and loads skills from configured user skill root", () => {
    const userRoot = mkdtempSync(path.join(tmpdir(), "geistr-user-skills-"));
    tempDirs.push(userRoot);
    const skillDir = path.join(userRoot, "my-skill");
    mkdirSync(skillDir);
    writeFileSync(skillDir + "/SKILL.md", "---\nname: my-skill\ndescription: User skill for testing.\n---\n\n# My Skill\n", "utf8");

    const registry = new SkillRegistry([{ source: "user", rootDir: userRoot }]);

    expect(registry.list()).toEqual([{ name: "my-skill", description: "User skill for testing.", source: "user" }]);
    expect(registry.load("my-skill")).toMatchObject({ name: "my-skill", source: "user" });
  });

  test("loads SKILL.md and referenced GLOSSARY.md", () => {
    const loaded = new SkillRegistry().load("writing-great-skills");
    expect("error" in loaded).toBe(false);
    if ("error" in loaded) return;

    expect(loaded.name).toBe("writing-great-skills");
    expect(loaded.source).toBe("builtin");
    expect(loaded.files.map((file) => file.path)).toEqual(["SKILL.md", "GLOSSARY.md"]);
    expect(loaded.files.find((file) => file.path === "SKILL.md")?.content).toContain("A skill exists to wrangle determinism");
    expect(loaded.files.find((file) => file.path === "GLOSSARY.md")?.content).toContain("# Glossary — Building Great Skills");
  });

  test("can load only SKILL.md", () => {
    const loaded = new SkillRegistry().load("writing-great-skills", { includeReferences: false });
    expect("error" in loaded).toBe(false);
    if ("error" in loaded) return;
    expect(loaded.files.map((file) => file.path)).toEqual(["SKILL.md"]);
  });

  test("unknown skill returns clean error", () => {
    expect(new SkillRegistry().load("missing-skill")).toEqual({ error: "unknown skill: missing-skill" });
  });

  test("path traversal names are rejected", () => {
    expect(new SkillRegistry().load("../writing-great-skills")).toEqual({ error: "invalid skill name" });
  });
});

describe("skill_load tool", () => {
  test("tool definitions expose exactly one skill tool", async () => {
    const tools = createSkillToolDefinitions(new SkillRegistry());
    expect(tools.map((tool) => tool.name)).toEqual(["skill_load"]);
    const tool = tools[0];
    expect(tool).toBeDefined();
    const result = await tool?.execute?.("call_1", { name: "writing-great-skills" }, new AbortController().signal, () => undefined, {} as never);
    expect(result?.details).toMatchObject({ name: "writing-great-skills", source: "builtin" });
  });

  test("skill_load is classified as safe/read-only", () => {
    expect(classifyToolPermission({ toolName: "skill_load" })).toEqual({
      tier: "safe",
      reason: "skill_load is a read-only tool.",
    });
  });
});
