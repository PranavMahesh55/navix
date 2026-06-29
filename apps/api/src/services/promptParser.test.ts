import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptParser } from "./promptParser.js";

describe("PromptParser", () => {
  it("detects impact prompts and clamps depth", () => {
    const parsed = new PromptParser().parse({
      prompt: "What is the impact if I modify token refresh?",
      depth: 9
    });

    assert.equal(parsed.intent, "impact_analysis");
    assert.equal(parsed.feature, "authentication");
    assert.equal(parsed.depth, 4);
  });

  it("extracts a useful fallback feature from arbitrary prompts", () => {
    const parsed = new PromptParser().parse({
      prompt: "Explain query schema graph loading.",
      depth: 2
    });

    assert.equal(parsed.intent, "architecture_flow");
    assert.equal(parsed.feature, "query schema graph");
  });

  it("names test coverage prompts by the target feature", () => {
    const parsed = new PromptParser().parse({
      prompt: "test coverage for schema_to_ddl schema rust tests",
      depth: 4
    });

    assert.equal(parsed.intent, "test_coverage_view");
    assert.equal(parsed.feature, "schema to ddl");
  });
});
