import type { GraphEdge, GraphNode } from "@navix/shared";

const sanitizeId = (id: string) => {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `node_${cleaned}`;
};

const escapeLabel = (value: string) => value.replace(/"/g, '\\"');

export const graphToMermaid = (nodes: GraphNode[], edges: GraphEdge[], title?: string) => {
  const lines = ["flowchart TD"];

  if (title) {
    lines.push(`  %% ${title}`);
  }

  for (const node of nodes) {
    lines.push(`  ${sanitizeId(node.id)}["${escapeLabel(node.label)}<br/>${node.type}"]`);
  }

  for (const edge of edges) {
    lines.push(
      `  ${sanitizeId(edge.source)} -->|"${escapeLabel(edge.label)}"| ${sanitizeId(edge.target)}`
    );
  }

  return lines.join("\n");
};
