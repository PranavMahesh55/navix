export const GRAPH_LIMITS = {
  maxNodes: 20,
  maxEdges: 30,
  defaultDepth: 2
} as const;

export const ARCHITECTURE_NODE_TYPES = [
  "ui",
  "controller",
  "service",
  "model",
  "api",
  "database",
  "test",
  "config",
  "utility",
  "external"
] as const;

export type ArchitectureNodeType = (typeof ARCHITECTURE_NODE_TYPES)[number];

export type ArchitectureIntent =
  | "architecture_flow"
  | "dependency_map"
  | "onboarding_path"
  | "impact_analysis"
  | "test_coverage_view";

export type GraphNode = {
  id: string;
  label: string;
  type: ArchitectureNodeType;
  filePath?: string | undefined;
  summary?: string | undefined;
  indexedDefinitions?: string[] | undefined;
  importanceScore: number;
  dependencies?: string[] | undefined;
  relatedTests?: string[] | undefined;
  tags?: string[] | undefined;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: "execution" | "dependency" | "data" | "test" | "ownership" | "external";
  evidence?: {
    source: "orbit-call" | "orbit-import" | "test-match" | "module-context" | "mock";
    detail: string;
  } | undefined;
};

export type PromptIntent = {
  feature: string;
  intent: ArchitectureIntent;
  depth: number;
  rawPrompt: string;
};

export type ArchitectureGenerateRequest = {
  prompt: string;
  repoUrl?: string | undefined;
  depth?: number | undefined;
};

export type NodeExpansionRequest = {
  nodeId: string;
  prompt?: string | undefined;
  repoUrl?: string | undefined;
  depth?: number | undefined;
  currentNodeIds?: string[] | undefined;
};

export type OrbitSymbol = {
  id: string;
  name: string;
  type: ArchitectureNodeType;
  filePath?: string | undefined;
  summary: string;
  indexedDefinitions?: string[] | undefined;
  importanceScore: number;
  dependencies?: string[] | undefined;
  relatedTests?: string[] | undefined;
  tags?: string[] | undefined;
};

export type OrbitDependency = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: GraphEdge["type"];
  evidence?: GraphEdge["evidence"];
};

export type OrbitQueryResult = {
  provider: "mock-orbit" | "gitlab-orbit";
  repoUrl?: string | undefined;
  feature: string;
  intent: ArchitectureIntent;
  symbols: OrbitSymbol[];
  dependencies: OrbitDependency[];
  limitations: string[];
};

export type NodeDetails = {
  id: string;
  label: string;
  type: ArchitectureNodeType;
  filePath?: string | undefined;
  summary: string;
  purpose: string;
  indexedDefinitions?: string[] | undefined;
  onboardingNotes?: string[] | undefined;
  inspectionQuestions?: string[] | undefined;
  dependencies: GraphNode[];
  dependents: GraphNode[];
  relatedTests: GraphNode[];
  relationshipEvidence?: string[] | undefined;
  evidence?: {
    sourceFile?: string | undefined;
    snippetLineCount?: number | undefined;
    indexedDefinitionCount: number;
    incomingCount: number;
    outgoingCount: number;
    relatedTestCount: number;
    confidence: "high" | "medium" | "low";
    missing: string[];
  } | undefined;
  tags: string[];
  sourceGrounding?: {
    status: "openai";
    model: string;
    repoUrl: string;
    filePath: string;
    snippetLineCount: number;
    generatedAt: string;
  } | undefined;
};

export type LearningPathStep = {
  order: number;
  nodeId: string;
  label: string;
  reason: string;
};

export type ArchitectureResponse = {
  prompt: PromptIntent;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeDetails: Record<string, NodeDetails>;
  overview: string;
  learningPath: LearningPathStep[];
  grounding: {
    provider: OrbitQueryResult["provider"];
    repoUrl?: string | undefined;
    symbolCount: number;
    generatedAt: string;
    limitations: string[];
  };
};

export type NodeExpansionResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeDetails: Record<string, NodeDetails>;
  learningPath: LearningPathStep[];
  grounding: ArchitectureResponse["grounding"];
};

export type MermaidExportRequest = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  title?: string | undefined;
};

export type MermaidExportResponse = {
  mermaid: string;
};
