import type { GraphEdge, GraphNode } from "@orbit-atlas/shared";
import type { Edge, Node } from "@xyflow/react";
import type { AtlasNodeData } from "../types/graph";

const typeLevel: Record<string, number> = {
  ui: 0,
  api: 1,
  controller: 2,
  service: 3,
  model: 4,
  database: 5,
  utility: 5,
  config: 5,
  external: 6,
  test: 6
};

const maxColumn = 6;
const columnSpacing = 304;
const rowSpacing = 118;

const edgeStyles: Record<GraphEdge["type"], { color: string; dashed?: boolean; animated?: boolean }> = {
  execution: { color: "#18796f", animated: true },
  dependency: { color: "#64748b" },
  data: { color: "#a16207" },
  test: { color: "#7c3aed", dashed: true },
  ownership: { color: "#64748b", dashed: true },
  external: { color: "#c2410c" }
};

export const buildFlowElements = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  showTests: boolean,
  selectedNodeId?: string | undefined
): { flowNodes: Node<AtlasNodeData>[]; flowEdges: Edge[] } => {
  const visibleNodes = nodes.filter((node) => showTests || node.type !== "test");
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => {
    return visibleIds.has(edge.source) && visibleIds.has(edge.target);
  });

  const levels = computeNodeLevels(visibleNodes, visibleEdges);
  const grouped = new Map<number, GraphNode[]>();
  for (const node of visibleNodes) {
    const level = levels.get(node.id) ?? typeLevel[node.type] ?? 3;
    grouped.set(level, [...(grouped.get(level) ?? []), node]);
  }

  const flowNodes = visibleNodes.map((node) => {
    const level = levels.get(node.id) ?? typeLevel[node.type] ?? 3;
    const group = grouped.get(level) ?? [node];
    const index = group.findIndex((candidate) => candidate.id === node.id);
    const centeredIndex = index - (group.length - 1) / 2;

    return {
      id: node.id,
      type: "atlas",
      data: { atlasNode: node },
      position: {
        x: 56 + level * columnSpacing,
        y: 96 + centeredIndex * rowSpacing
      }
    } satisfies Node<AtlasNodeData>;
  });

  const hasSelection = Boolean(selectedNodeId && visibleIds.has(selectedNodeId));
  const flowEdges = visibleEdges.map((edge) => {
    const style = edgeStyles[edge.type];
    const isSelectedRelationship = hasSelection && (edge.source === selectedNodeId || edge.target === selectedNodeId);
    const shouldLabel = !hasSelection || isSelectedRelationship;
    const opacity = hasSelection ? (isSelectedRelationship ? 0.96 : 0.24) : 0.68;
    const flowEdge: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: shouldLabel ? edge.label : undefined,
      type: "smoothstep",
      className: isSelectedRelationship ? "relationship-edge active" : "relationship-edge muted",
      style: {
        stroke: style.color,
        strokeOpacity: opacity,
        strokeWidth: isSelectedRelationship ? 2.8 : edge.type === "execution" ? 2.2 : 1.6
      },
      labelStyle: {
        fill: "#334155",
        fontSize: 12,
        fontWeight: 750
      },
      labelBgStyle: {
        fill: "#ffffff",
        fillOpacity: 0.96,
        stroke: "#dbe4ee",
        strokeWidth: 1
      },
      labelBgPadding: [9, 5],
      labelBgBorderRadius: 8
    };

    if (style.animated) {
      flowEdge.animated = true;
    }

    if (style.dashed) {
      flowEdge.style = {
        ...flowEdge.style,
        strokeDasharray: "6 5"
      };
    }

    return flowEdge;
  });

  return { flowNodes, flowEdges };
};

const computeNodeLevels = (nodes: GraphNode[], edges: GraphEdge[]) => {
  const ids = new Set(nodes.map((node) => node.id));
  const levels = new Map<string, number>();

  for (const node of nodes) {
    levels.set(node.id, typeLevel[node.type] ?? 3);
  }

  const structuralEdges = edges.filter((edge) => {
    return edge.type !== "test" && ids.has(edge.source) && ids.has(edge.target);
  });

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;

    for (const edge of structuralEdges) {
      const sourceLevel = levels.get(edge.source) ?? 0;
      const targetLevel = levels.get(edge.target) ?? 0;
      const nextTargetLevel = Math.min(maxColumn, sourceLevel + 1);

      if (targetLevel <= sourceLevel && nextTargetLevel !== targetLevel) {
        levels.set(edge.target, nextTargetLevel);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return levels;
};
