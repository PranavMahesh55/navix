import type {
  GraphEdge,
  GraphNode,
  OrbitDependency,
  OrbitQueryResult,
  OrbitSymbol
} from "@navix/shared";
import { config } from "../config/env.js";

type GraphBuildResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const typeWeight: Record<string, number> = {
  ui: 10,
  api: 9,
  controller: 10,
  service: 12,
  model: 8,
  database: 7,
  test: 5,
  config: 4,
  utility: 6,
  external: 6
};

export class GraphBuilder {
  build(result: OrbitQueryResult, depth = config.defaultGraphDepth): GraphBuildResult {
    const limits = this.depthLimits(depth);
    const rankedSymbols = [...result.symbols].sort((a, b) => {
      return this.rankSymbol(b, result.dependencies) - this.rankSymbol(a, result.dependencies);
    });
    const keptSymbols = this.keepReadableGraph(rankedSymbols, result.dependencies, limits.maxNodes);
    const keptIds = new Set(keptSymbols.map((item) => item.id));

    const nodes = keptSymbols.map((item) => this.toNode(item));
    const edges = result.dependencies
      .filter((item) => keptIds.has(item.source) && keptIds.has(item.target))
      .sort((a, b) => this.rankEdge(b) - this.rankEdge(a))
      .slice(0, limits.maxEdges)
      .map((item) => this.toEdge(item));

    return { nodes, edges };
  }

  private keepReadableGraph(symbols: OrbitSymbol[], dependencies: OrbitDependency[], maxNodes: number) {
    const selected = new Map<string, OrbitSymbol>();

    const entrypoints = symbols.filter((item) => item.tags?.includes("entrypoint"));
    for (const item of entrypoints) {
      selected.set(item.id, item);
    }

    for (const item of symbols) {
      if (selected.size >= maxNodes) {
        break;
      }
      selected.set(item.id, item);
    }

    const selectedIds = new Set(selected.keys());
    const selectedEdgeCount = dependencies.filter((item) => {
      return selectedIds.has(item.source) && selectedIds.has(item.target);
    }).length;

    if (selectedEdgeCount === 0 && symbols.length > 0) {
      for (const item of symbols.slice(0, maxNodes)) {
        selected.set(item.id, item);
      }
    }

    return [...selected.values()];
  }

  private depthLimits(depth: number) {
    const normalizedDepth = Math.min(Math.max(Math.round(depth), 1), 4);

    const maxNodesByDepth = [0, 6, 10, 13, config.maxGraphNodes];
    const maxEdgesByDepth = [0, 8, 16, 24, config.maxGraphEdges];

    return {
      maxNodes: Math.min(config.maxGraphNodes, maxNodesByDepth[normalizedDepth] ?? config.maxGraphNodes),
      maxEdges: Math.min(config.maxGraphEdges, maxEdgesByDepth[normalizedDepth] ?? config.maxGraphEdges)
    };
  }

  private rankSymbol(item: OrbitSymbol, dependencies: OrbitDependency[] = []) {
    const degree = dependencies.filter((edge) => edge.source === item.id || edge.target === item.id).length;
    const relationshipBonus = Math.min(degree * 8, 32);
    return item.importanceScore + (typeWeight[item.type] ?? 0) + relationshipBonus + (item.tags?.includes("entrypoint") ? 15 : 0);
  }

  private rankEdge(item: OrbitDependency) {
    const edgeWeight: Record<GraphEdge["type"], number> = {
      execution: 5,
      dependency: 3,
      data: 4,
      test: 2,
      ownership: 1,
      external: 3
    };

    return edgeWeight[item.type] ?? 0;
  }

  private toNode(item: OrbitSymbol): GraphNode {
    return {
      id: item.id,
      label: item.name,
      type: item.type,
      filePath: item.filePath,
      summary: item.summary,
      indexedDefinitions: item.indexedDefinitions,
      importanceScore: item.importanceScore,
      dependencies: item.dependencies,
      relatedTests: item.relatedTests,
      tags: item.tags
    };
  }

  private toEdge(item: OrbitDependency): GraphEdge {
    return {
      id: item.id,
      source: item.source,
      target: item.target,
      label: item.label,
      type: item.type,
      evidence: item.evidence
    };
  }
}
