import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrbitQueryResult, OrbitSymbol } from "@navix/shared";
import { GraphBuilder } from "./graphBuilder.js";

const symbol = (id: string, importanceScore: number, tags: string[] = []): OrbitSymbol => ({
  id,
  name: id,
  type: id.includes("test") ? "test" : "service",
  filePath: `src/${id}.ts`,
  summary: `${id} summary`,
  indexedDefinitions: [id],
  importanceScore,
  dependencies: [],
  relatedTests: [],
  tags
});

describe("GraphBuilder", () => {
  it("keeps a readable depth-limited graph with entrypoints", () => {
    const result: OrbitQueryResult = {
      provider: "mock-orbit",
      feature: "checkout",
      intent: "architecture_flow",
      symbols: [
        symbol("entry", 10, ["entrypoint"]),
        symbol("core", 99),
        symbol("helper", 80),
        symbol("leaf", 70),
        symbol("test-node", 65)
      ],
      dependencies: [
        {
          id: "entry-core",
          source: "entry",
          target: "core",
          label: "calls core",
          type: "execution",
          evidence: { source: "mock", detail: "Mock call." }
        },
        {
          id: "core-helper",
          source: "core",
          target: "helper",
          label: "imports helper",
          type: "dependency",
          evidence: { source: "mock", detail: "Mock import." }
        }
      ],
      limitations: []
    };

    const graph = new GraphBuilder().build(result, 1);

    assert.ok(graph.nodes.some((node) => node.id === "entry"));
    assert.ok(graph.nodes.length <= 6);
    assert.equal(graph.edges[0]?.evidence?.source, "mock");
  });
});
