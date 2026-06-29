import type {
  ArchitectureGenerateRequest,
  ArchitectureResponse,
  GraphEdge,
  GraphNode,
  MermaidExportResponse,
  NodeDetails,
  NodeExpansionRequest,
  NodeExpansionResponse
} from "@navix/shared";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "/api" : "http://localhost:8080/api");

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    ...options
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const generateArchitecture = (payload: ArchitectureGenerateRequest) => {
  return request<ArchitectureResponse>("/architecture/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const expandNode = (payload: NodeExpansionRequest) => {
  return request<NodeExpansionResponse>("/architecture/expand-node", {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const getNodeDetails = (nodeId: string, repoUrl?: string | undefined, details?: NodeDetails | undefined) => {
  return request<NodeDetails>(`/architecture/node/${encodeURIComponent(nodeId)}`, {
    method: "POST",
    body: JSON.stringify({ repoUrl, details })
  });
};

export const exportMermaid = (nodes: GraphNode[], edges: GraphEdge[], title?: string) => {
  return request<MermaidExportResponse>("/architecture/export/mermaid", {
    method: "POST",
    body: JSON.stringify({ nodes, edges, title })
  });
};
