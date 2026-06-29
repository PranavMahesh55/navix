import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GraphEdge, GraphNode, OrbitQueryResult, PromptIntent } from "@navix/shared";
import { ExplanationService } from "./explanationService.js";

const prompt: PromptIntent = {
  feature: "query schema graph",
  intent: "architecture_flow",
  depth: 2,
  rawPrompt: "Explain query schema graph loading."
};

describe("ExplanationService", () => {
  it("is honest when Orbit returns no nodes", () => {
    const orbitResult: OrbitQueryResult = {
      provider: "gitlab-orbit",
      repoUrl: "https://gitlab.com/group/project",
      feature: prompt.feature,
      intent: prompt.intent,
      symbols: [],
      dependencies: [],
      limitations: ["Orbit authentication failed."]
    };

    const response = new ExplanationService().explain(prompt, orbitResult, [], []);

    assert.match(response.overview, /returned no grounded components/i);
    assert.equal(response.grounding.limitations[0], "Orbit authentication failed.");
  });

  it("builds evidence and a fallback multi-step learning path", () => {
    const nodes: GraphNode[] = [
      node("schema", 90, ["entrypoint"]),
      node("app", 70),
      node("writer", 60),
      node("query", 50)
    ];
    const edges: GraphEdge[] = [
      edge("app", "schema", "imports SchemaConfig"),
      edge("app", "writer", "imports writer"),
      edge("query", "writer", "imports writer")
    ];
    const orbitResult: OrbitQueryResult = {
      provider: "gitlab-orbit",
      repoUrl: "https://gitlab.com/group/project",
      feature: prompt.feature,
      intent: prompt.intent,
      symbols: nodes.map((item) => ({
        id: item.id,
        name: item.label,
        type: item.type,
        filePath: item.filePath,
        summary: item.summary ?? "",
        indexedDefinitions: item.indexedDefinitions,
        importanceScore: item.importanceScore,
        dependencies: item.dependencies,
        relatedTests: item.relatedTests,
        tags: item.tags
      })),
      dependencies: edges,
      limitations: []
    };

    const response = new ExplanationService().explain(prompt, orbitResult, nodes, edges);

    assert.ok(response.learningPath.length >= 3);
    const schemaDetails = response.nodeDetails.schema;
    const writerDetails = response.nodeDetails.writer;

    assert.ok(schemaDetails);
    assert.ok(writerDetails);
    assert.equal(schemaDetails.evidence?.confidence, "high");
    assert.ok(writerDetails.relationshipEvidence?.some((item) => item.includes("imports writer")));
  });
});

const node = (id: string, importanceScore: number, tags: string[] = []): GraphNode => ({
  id,
  label: id,
  type: id === "schema" ? "model" : "service",
  filePath: `src/${id}.ts`,
  summary: `${id} summary`,
  indexedDefinitions: [id],
  importanceScore,
  dependencies: [],
  relatedTests: [],
  tags
});

const edge = (source: string, target: string, label: string): GraphEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
  type: "dependency",
  evidence: {
    source: "orbit-import",
    detail: label
  }
});
