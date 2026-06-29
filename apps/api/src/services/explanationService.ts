import type {
  ArchitectureResponse,
  ArchitectureNodeType,
  GraphEdge,
  GraphNode,
  LearningPathStep,
  NodeDetails,
  OrbitQueryResult,
  PromptIntent
} from "@navix/shared";

type RoleGuidance = {
  noun: string;
  focus: string;
  editRisk: string;
  question: string;
};

const roleGuidance: Record<ArchitectureNodeType, RoleGuidance> = {
  ui: {
    noun: "user-facing entry surface",
    focus: "what the developer or user can trigger, which state changes locally, and which backend boundary is called next",
    editRisk: "Changes here tend to affect the visible workflow and the request shape sent downstream.",
    question: "What user action or screen state causes this node to run?"
  },
  controller: {
    noun: "request-routing boundary",
    focus: "validation, request mapping, service handoff, and response/error translation",
    editRisk: "Changes here can alter the contract callers depend on even when the core service stays unchanged.",
    question: "Which inputs are validated here before the flow enters the core logic?"
  },
  service: {
    noun: "coordination layer",
    focus: "the main decision path, the order dependencies are called, and the rules that tie those dependencies together",
    editRisk: "Changes here usually have the broadest behavior impact because this layer coordinates multiple collaborators.",
    question: "Which branch or dependency call represents the main business decision?"
  },
  model: {
    noun: "data boundary",
    focus: "the shape of state, persistence assumptions, validation rules, and fields other components rely on",
    editRisk: "Changes here can ripple into services, migrations, API payloads, and tests that assume the same data shape.",
    question: "Which fields or invariants are other nodes relying on?"
  },
  api: {
    noun: "API or client boundary",
    focus: "the request/response contract, error handling, authentication assumptions, and external or internal service call",
    editRisk: "Changes here can break callers even if the underlying implementation still works.",
    question: "What contract is this node exposing or consuming?"
  },
  database: {
    noun: "persistence boundary",
    focus: "stored state, schema constraints, indexes, migrations, and the assumptions data-access code makes",
    editRisk: "Changes here can affect historical data, migrations, and every model or service reading the same storage.",
    question: "Which code paths read or write this stored state?"
  },
  test: {
    noun: "behavioral safety net",
    focus: "the expected behavior, edge cases, fixtures, and regression signals around the mapped feature",
    editRisk: "Changes here alter what behavior the team can trust during refactors.",
    question: "Which behavior is this test proving, and which production node does it protect?"
  },
  config: {
    noun: "configuration boundary",
    focus: "runtime defaults, environment-driven behavior, feature flags, and setup values consumed elsewhere",
    editRisk: "Changes here can alter behavior across environments without touching the core flow.",
    question: "Which defaults or environment values change downstream behavior?"
  },
  utility: {
    noun: "shared support module",
    focus: "reusable transformations, helpers, glue code, and low-level behavior that other nodes import",
    editRisk: "Changes here can be deceptively wide because several paths may reuse the same helper behavior.",
    question: "Which callers reuse this behavior, and do they need the same assumptions?"
  },
  external: {
    noun: "external-system boundary",
    focus: "protocol details, third-party assumptions, timeout/error handling, and data exchanged with systems outside this code path",
    editRisk: "Changes here can affect integration reliability and compatibility with systems outside the repository.",
    question: "What can fail outside this repository, and how is that failure represented here?"
  }
};

export class ExplanationService {
  explain(
    prompt: PromptIntent,
    orbitResult: OrbitQueryResult,
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): ArchitectureResponse {
    const nodeDetails = this.buildNodeDetails(nodes, edges);

    return {
      prompt,
      nodes,
      edges,
      nodeDetails,
      overview: this.buildOverview(prompt, nodes, edges),
      learningPath: this.buildLearningPath(nodes, edges),
      grounding: {
        provider: orbitResult.provider,
        repoUrl: orbitResult.repoUrl,
        symbolCount: orbitResult.symbols.length,
        generatedAt: new Date().toISOString(),
        limitations: orbitResult.limitations
      }
    };
  }

  buildNodeDetails(nodes: GraphNode[], edges: GraphEdge[]): Record<string, NodeDetails> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const details: Record<string, NodeDetails> = {};

    for (const node of nodes) {
      const outgoing = edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => byId.get(edge.target))
        .filter((value): value is GraphNode => Boolean(value));

      const incoming = edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => byId.get(edge.source))
        .filter((value): value is GraphNode => Boolean(value));

      const relatedTests = nodes.filter((candidate) => {
        return candidate.type === "test" && (candidate.dependencies ?? []).includes(node.id);
      });
      const relationshipEvidence = this.buildRelationshipEvidence(node, edges, byId);
      const uniqueOutgoing = uniqueNodes(outgoing);
      const uniqueIncoming = uniqueNodes(incoming);
      const uniqueRelatedTests = uniqueNodes(relatedTests);

      details[node.id] = {
        id: node.id,
        label: node.label,
        type: node.type,
        filePath: node.filePath,
        summary: node.summary ?? this.fallbackSummary(node, uniqueOutgoing, uniqueIncoming),
        purpose: this.buildPurpose(node, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        indexedDefinitions: node.indexedDefinitions ?? [],
        onboardingNotes: this.buildOnboardingNotes(node, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        inspectionQuestions: this.buildInspectionQuestions(node, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        dependencies: uniqueOutgoing,
        dependents: uniqueIncoming,
        relatedTests: uniqueRelatedTests,
        relationshipEvidence,
        evidence: this.buildEvidence(node, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests, relationshipEvidence),
        tags: node.tags ?? []
      };
    }

    return details;
  }

  buildLearningPath(nodes: GraphNode[], edges: GraphEdge[]): LearningPathStep[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const entry = nodes.find((node) => node.tags?.includes("entrypoint")) ?? nodes[0];

    if (!entry) {
      return [];
    }

    const path: GraphNode[] = [];
    const visited = new Set<string>();
    const queue = [entry.id];

    while (queue.length > 0 && path.length < 5) {
      const nodeId = queue.shift();
      if (!nodeId || visited.has(nodeId)) {
        continue;
      }

      const node = byId.get(nodeId);
      if (!node) {
        continue;
      }

      visited.add(nodeId);
      path.push(node);

      const nextIds = edges
        .filter((edge) => edge.source === nodeId && edge.type !== "test")
        .map((edge) => edge.target);
      queue.push(...nextIds);
    }

    if (path.length < 4) {
      const candidates = [...nodes]
        .filter((node) => !visited.has(node.id) && node.type !== "test")
        .sort((a, b) => {
          const aDegree = edges.filter((edge) => edge.source === a.id || edge.target === a.id).length;
          const bDegree = edges.filter((edge) => edge.source === b.id || edge.target === b.id).length;
          return (bDegree - aDegree) || (b.importanceScore - a.importanceScore);
        });
      for (const candidate of candidates) {
        if (path.length >= 5) {
          break;
        }
        visited.add(candidate.id);
        path.push(candidate);
      }
    }

    const firstTest = nodes.find((node) => node.type === "test");
    if (firstTest && !visited.has(firstTest.id) && path.length < 6) {
      path.push(firstTest);
    }

    return path.map((node, index) => ({
      order: index + 1,
      nodeId: node.id,
      label: node.label,
      reason: this.learningReason(node, index)
    }));
  }

  private buildOverview(prompt: PromptIntent, nodes: GraphNode[], edges: GraphEdge[]) {
    const entry = nodes.find((node) => node.tags?.includes("entrypoint")) ?? nodes[0];
    const core = nodes.find((node) => node.type === "service") ?? nodes[0];
    const tests = nodes.filter((node) => node.type === "test").length;

    if (!entry || !core) {
      return `Orbit returned no grounded components for "${prompt.rawPrompt}".`;
    }

    return `For "${prompt.rawPrompt}", Navix found ${nodes.length} grounded component${nodes.length === 1 ? "" : "s"} and ${edges.length} relationship${edges.length === 1 ? "" : "s"}. Start with ${entry.label}, then follow the mapped relationships toward ${core.label} to understand the main path. Treat the side panel as the reading guide: it shows what each node represents, which definitions Orbit indexed, and what to check before editing.${tests > 0 ? ` ${tests} related test node${tests === 1 ? "" : "s"} appeared in this graph.` : ""}`;
  }

  private learningReason(node: GraphNode, index: number) {
    if (index === 0) {
      return "Start at the entry point Orbit identified for the feature.";
    }

    if (node.type === "test") {
      return "Use the related test to confirm expected behavior before editing.";
    }

    if (node.type === "service") {
      return "Read this core service to understand the main business decision path.";
    }

    if (node.type === "database" || node.type === "model") {
      return "Inspect this data boundary to understand what state the feature touches.";
    }

    return "Follow the next dependency in the execution path.";
  }

  private buildRelationshipEvidence(
    node: GraphNode,
    edges: GraphEdge[],
    byId: Map<string, GraphNode>
  ) {
    return edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .slice(0, 8)
      .map((edge) => {
        const source = byId.get(edge.source)?.label ?? edge.source;
        const target = byId.get(edge.target)?.label ?? edge.target;
        const evidence = edge.evidence?.detail ?? edge.label;
        return `${source} -> ${target}: ${evidence}`;
      });
  }

  private buildEvidence(
    node: GraphNode,
    outgoing: GraphNode[],
    incoming: GraphNode[],
    relatedTests: GraphNode[],
    relationshipEvidence: string[]
  ): NodeDetails["evidence"] {
    const missing: string[] = [];
    if (relatedTests.length === 0) {
      missing.push("No related tests appeared at this graph depth.");
    }
    if (outgoing.length === 0) {
      missing.push("No outgoing dependency was visible at this graph depth.");
    }
    if ((node.indexedDefinitions ?? []).length === 0) {
      missing.push("Orbit did not return named definitions for this node.");
    }

    const confidence = relationshipEvidence.length > 0 && (node.indexedDefinitions ?? []).length > 0
      ? "high"
      : node.filePath || relationshipEvidence.length > 0
        ? "medium"
        : "low";

    return {
      sourceFile: node.filePath,
      indexedDefinitionCount: node.indexedDefinitions?.length ?? 0,
      incomingCount: incoming.length,
      outgoingCount: outgoing.length,
      relatedTestCount: relatedTests.length,
      confidence,
      missing
    };
  }

  private fallbackSummary(node: GraphNode, outgoing: GraphNode[], incoming: GraphNode[]) {
    const guidance = roleGuidance[node.type];
    const relationship = this.relationshipPhrase(outgoing, incoming);
    return `${node.label} is ${withArticle(guidance.noun)}${node.filePath ? ` in ${node.filePath}` : ""}. ${relationship} Read it to understand ${guidance.focus}.`;
  }

  private buildPurpose(node: GraphNode, outgoing: GraphNode[], incoming: GraphNode[], relatedTests: GraphNode[]) {
    const guidance = roleGuidance[node.type];
    const relationship = this.relationshipPhrase(outgoing, incoming);
    const testSentence = relatedTests.length > 0
      ? ` The graph also links it to ${formatNodeList(relatedTests)}, which gives you a starting point for expected behavior.`
      : " No related test node appeared in this graph depth, so verify coverage before changing behavior.";

    const groundedSummary = node.summary?.trim() || `${node.label} acts as ${withArticle(guidance.noun)} for this slice of the codebase.`;
    return `${groundedSummary} ${relationship} ${guidance.editRisk}${testSentence}`;
  }

  private buildOnboardingNotes(
    node: GraphNode,
    outgoing: GraphNode[],
    incoming: GraphNode[],
    relatedTests: GraphNode[]
  ) {
    const notes: string[] = [];

    if (node.tags?.includes("entrypoint")) {
      notes.push("Start here because Orbit tagged this node as an entry point for the requested feature.");
    }

    if (node.filePath) {
      notes.push(`Anchor your code reading in ${node.filePath}; use the graph edges to decide what to open next.`);
    }

    const definitions = node.indexedDefinitions?.slice(0, 5) ?? [];
    if (definitions.length > 0) {
      notes.push(`Skim the indexed definitions first: ${definitions.join(", ")}.`);
    }

    if (outgoing.length > 0) {
      notes.push(`Follow outgoing relationships to ${formatNodeList(outgoing)} to see what this node calls, imports, or hands work to.`);
    }

    if (incoming.length > 0) {
      notes.push(`Check incoming dependents from ${formatNodeList(incoming)} before editing; those nodes are the first places likely to feel a change here.`);
    }

    if (relatedTests.length > 0) {
      notes.push(`Use ${formatNodeList(relatedTests)} as the first behavior check for this node.`);
    }

    if (notes.length === 0) {
      notes.push("Orbit did not expose neighbors for this node at the current depth, so inspect the source path and increase depth if you need more surrounding context.");
    }

    return notes;
  }

  private buildInspectionQuestions(
    node: GraphNode,
    outgoing: GraphNode[],
    incoming: GraphNode[],
    relatedTests: GraphNode[]
  ) {
    const guidance = roleGuidance[node.type];
    const questions = [guidance.question];

    if (outgoing.length > 0) {
      questions.push(`What assumptions does it pass to ${formatNodeList(outgoing)}?`);
    } else {
      questions.push("Is this a leaf in the current map, or did the selected depth hide the next hop?");
    }

    if (incoming.length > 0) {
      questions.push(
        incoming.length === 1
          ? `What behavior does ${formatNodeList(incoming)} expect from this node?`
          : `What behavior do ${formatNodeList(incoming)} expect from this node?`
      );
    }

    if (relatedTests.length > 0) {
      questions.push(`Which scenario in ${formatNodeList(relatedTests)} would fail if this node changed?`);
    } else {
      questions.push("Where is the closest test or fixture that proves this behavior?");
    }

    return questions;
  }

  private relationshipPhrase(outgoing: GraphNode[], incoming: GraphNode[]) {
    if (incoming.length > 0 && outgoing.length > 0) {
      return `In this map it receives flow from ${formatNodeList(incoming)} and points to ${formatNodeList(outgoing)}.`;
    }

    if (outgoing.length > 0) {
      return `In this map it points to ${formatNodeList(outgoing)}, making those nodes the next places to read.`;
    }

    if (incoming.length > 0) {
      return `In this map it is depended on by ${formatNodeList(incoming)}, so read those callers before changing it.`;
    }

    return "Orbit did not expose rendered neighbors for it at this depth.";
  }
}

const formatNodeList = (nodes: GraphNode[]) => {
  const labels = [...new Set(nodes.map((node) => node.label))].slice(0, 3);
  const suffix = nodes.length > labels.length ? ` and ${nodes.length - labels.length} more` : "";
  return `${labels.join(", ")}${suffix}`;
};

const uniqueNodes = (nodes: GraphNode[]) => {
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
};

const withArticle = (phrase: string) => {
  const article = /^(api|external|entry|integration|orchestration|event|adapter)\b/i.test(phrase) ? "an" : "a";
  return `${article} ${phrase}`;
};
