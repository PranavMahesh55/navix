import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchitectureResponse, GraphEdge, GraphNode, NodeDetails } from "@orbit-atlas/shared";
import {
  AlertCircle,
  BookOpen,
  FileText,
  GitBranch,
  Grid2X2,
  Layers,
  Map as MapIcon,
  Network,
  Orbit,
  Search,
  Share2,
  Shield,
  TestTube2,
  Upload,
  Zap
} from "lucide-react";
import { expandNode, exportMermaid, generateArchitecture, getNodeDetails } from "./api/architectureApi";
import { ArchitectureGraph } from "./components/ArchitectureGraph";
import { GraphToolbar } from "./components/GraphToolbar";
import { LearningPath } from "./components/LearningPath";
import { NodeDetailsPanel } from "./components/NodeDetailsPanel";
import { PromptInput } from "./components/PromptInput";
import { StatusStrip } from "./components/StatusStrip";
import { roleStyles } from "./graph/roleStyles";

type WorkspaceSection = "overview" | "architecture" | "learning" | "impact" | "tests";

const defaultPrompt = import.meta.env.VITE_DEFAULT_PROMPT ?? "Explain query schema graph loading.";
const defaultRepoUrl =
  import.meta.env.VITE_DEFAULT_REPO_URL ??
  "https://gitlab.com/gitlab-community/gitlab-org/orbit/knowledge-graph";

const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]) => {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
};

export const App = () => {
  const [response, setResponse] = useState<ArchitectureResponse>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [showTests, setShowTests] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [lastPrompt, setLastPrompt] = useState(defaultPrompt);
  const [lastRepoUrl, setLastRepoUrl] = useState<string | undefined>(defaultRepoUrl);
  const [draftRepoUrl, setDraftRepoUrl] = useState(defaultRepoUrl);
  const [activeDepth, setActiveDepth] = useState(2);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("overview");
  const [resetSignal, setResetSignal] = useState(0);
  const [mermaid, setMermaid] = useState<string>();
  const [semanticDetailLoadingIds, setSemanticDetailLoadingIds] = useState<Set<string>>(new Set());
  const [semanticDetailFailedIds, setSemanticDetailFailedIds] = useState<Set<string>>(new Set());
  const semanticDetailAttempts = useRef(new Set<string>());

  const selectedDetails = useMemo(() => {
    if (!selectedNodeId || !response) {
      return undefined;
    }
    return response.nodeDetails[selectedNodeId];
  }, [response, selectedNodeId]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !response) {
      return undefined;
    }
    return response.nodes.find((node) => node.id === selectedNodeId);
  }, [response, selectedNodeId]);

  const loadArchitecture = async (values: { prompt: string; repoUrl?: string | undefined; depth: number }) => {
    const nextRepoUrl = values.repoUrl?.trim() || undefined;
    setLoading(true);
    setError(undefined);
    setNotice(undefined);
    setMermaid(undefined);

    try {
      const next = await generateArchitecture({
        prompt: values.prompt,
        repoUrl: nextRepoUrl,
        depth: values.depth
      });
      setResponse(next);
      setSelectedNodeId(next.learningPath[0]?.nodeId ?? next.nodes[0]?.id);
      setLastPrompt(values.prompt);
      setLastRepoUrl(nextRepoUrl);
      setDraftRepoUrl(nextRepoUrl ?? "");
      setActiveDepth(values.depth);
      setResetSignal((value) => value + 1);
      semanticDetailAttempts.current.clear();
      setSemanticDetailLoadingIds(new Set());
      setSemanticDetailFailedIds(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate architecture map");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchitecture({
      prompt: defaultPrompt,
      repoUrl: defaultRepoUrl,
      depth: 2
    });
  }, []);

  const fetchSourceGroundedDetails = async (nodeId: string, currentResponse: ArchitectureResponse) => {
    const details = currentResponse.nodeDetails[nodeId];
    if (details?.sourceGrounding?.status === "openai") {
      return;
    }

    const repoUrl = currentResponse.grounding.repoUrl ?? lastRepoUrl;
    const attemptKey = `${repoUrl ?? "missing-repo"}:${nodeId}`;
    if (semanticDetailAttempts.current.has(attemptKey)) {
      return;
    }

    semanticDetailAttempts.current.add(attemptKey);
    setSemanticDetailLoadingIds((current) => new Set(current).add(nodeId));
    setSemanticDetailFailedIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });

    try {
      setError(undefined);
      const enriched = await getNodeDetails(nodeId, repoUrl);
      setResponse((latest) => {
        if (!latest) {
          return latest;
        }

        return {
          ...latest,
          nodeDetails: {
            ...latest.nodeDetails,
            [nodeId]: enriched
          }
        };
      });
    } catch (caught) {
      setSemanticDetailFailedIds((current) => new Set(current).add(nodeId));
      setError(caught instanceof Error ? caught.message : "Unable to generate source-grounded node details");
    } finally {
      setSemanticDetailLoadingIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!response || !selectedNodeId) {
      return;
    }

    void fetchSourceGroundedDetails(selectedNodeId, response);
  }, [selectedNodeId, response?.grounding.generatedAt]);

  const selectNode = async (node: GraphNode) => {
    setSelectedNodeId(node.id);

    if (!response) {
      return;
    }

    await fetchSourceGroundedDetails(node.id, response);
  };

  const selectLearningPathNode = (nodeId: string) => {
    const node = response?.nodes.find((candidate) => candidate.id === nodeId);
    if (node) {
      void selectNode(node);
    }
  };

  const expandSelected = async () => {
    if (!selectedNodeId || !response) {
      return;
    }

    setLoading(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const expansion = await expandNode({
        nodeId: selectedNodeId,
        prompt: lastPrompt,
        repoUrl: lastRepoUrl,
        depth: activeDepth,
        currentNodeIds: response.nodes.map((node) => node.id)
      });

      setResponse({
        ...response,
        nodes: mergeById(response.nodes, expansion.nodes),
        edges: mergeById(response.edges, expansion.edges),
        nodeDetails: {
          ...response.nodeDetails,
          ...expansion.nodeDetails
        },
        learningPath: expansion.learningPath.length > 0 ? expansion.learningPath : response.learningPath,
        grounding: expansion.grounding
      });
      setResetSignal((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to expand selected node");
    } finally {
      setLoading(false);
    }
  };

  const handleDepthChange = (depth: number) => {
    setActiveDepth(depth);
    if (!loading) {
      void loadArchitecture({
        prompt: lastPrompt,
        repoUrl: draftRepoUrl || lastRepoUrl,
        depth
      });
    }
  };

  const handleRepoSubmit = () => {
    void loadArchitecture({
      prompt: lastPrompt,
      repoUrl: draftRepoUrl,
      depth: activeDepth
    });
  };

  const handleExport = async () => {
    if (!response) {
      return;
    }

    try {
      const visibleNodes = response.nodes.filter((node) => showTests || node.type !== "test");
      const visibleIds = new Set(visibleNodes.map((node) => node.id));
      const visibleEdges = response.edges.filter((edge) => {
        return visibleIds.has(edge.source) && visibleIds.has(edge.target);
      });
      const exported = await exportMermaid(visibleNodes, visibleEdges, response.prompt.feature);
      setMermaid(exported.mermaid);
      try {
        await navigator.clipboard?.writeText(exported.mermaid);
        setNotice("Mermaid copied");
      } catch {
        setNotice("Mermaid generated");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export Mermaid");
    }
  };

  const handleShare = async () => {
    if (!response) {
      return;
    }

    const shareText = [
      "Orbit Atlas map",
      `Prompt: ${response.prompt.rawPrompt}`,
      `Repository: ${response.grounding.repoUrl ?? "not set"}`,
      `Depth: ${response.prompt.depth}`,
      `Nodes: ${response.nodes.length}`,
      `Edges: ${response.edges.length}`
    ].join("\n");

    try {
      await navigator.clipboard?.writeText(shareText);
      setNotice("Map summary copied");
    } catch {
      setNotice("Map summary ready");
    }
  };

  const focusPrompt = () => {
    document.getElementById("architecture-prompt")?.focus();
  };

  const navigateTo = (section: WorkspaceSection) => {
    setActiveSection(section);
    if (section === "tests") {
      setShowTests(true);
    }
    if (section === "architecture") {
      setResetSignal((value) => value + 1);
    }

    document.getElementById("workspace-focus")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const visibleGraph = useMemo(() => {
    if (!response) {
      return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    }

    return {
      nodes: response.nodes,
      edges: response.edges
    };
  }, [response]);

  return (
    <main className="atlas-dashboard">
      <aside className="atlas-sidebar">
        <SidebarBrand />
        <SidebarNavigation activeSection={activeSection} onSelect={navigateTo} />
        <DepthControl value={activeDepth} loading={loading} onChange={handleDepthChange} />
        <GroundingCard response={response} loading={loading} />
      </aside>

      <section className="atlas-workspace">
        <WorkspaceTopBar
          response={response}
          loading={loading}
          error={error}
          notice={notice}
          repoUrl={draftRepoUrl}
          onRepoUrlChange={setDraftRepoUrl}
          onRepoSubmit={handleRepoSubmit}
          onAsk={focusPrompt}
          onShare={handleShare}
          onExport={handleExport}
        />

        <section className="architecture-surface" id="overview">
          <PromptInput
            initialPrompt={defaultPrompt}
            repoUrl={draftRepoUrl}
            depth={activeDepth}
            loading={loading}
            onSubmit={loadArchitecture}
          />

          <WorkspaceFocusPanel
            section={activeSection}
            response={response}
            selectedDetails={selectedDetails}
            selectedNode={selectedNode}
            onSelectLearningPathNode={selectLearningPathNode}
          />

          <div className="graph-action-row">
            <GraphSummaryBar response={response} depth={activeDepth} showTests={showTests} />
            <GraphToolbar
              showTests={showTests}
              hasSelection={Boolean(selectedNodeId)}
              onResetView={() => setResetSignal((value) => value + 1)}
              onToggleTests={() => setShowTests((value) => !value)}
              onExpandSelected={expandSelected}
              onExportMermaid={handleExport}
            />
          </div>

          {error ? (
            <div className="graph-error" role="alert">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}

          <div className="graph-stage" id="architecture-map">
            <ArchitectureGraph
              nodes={visibleGraph.nodes}
              edges={visibleGraph.edges}
              showTests={showTests}
              selectedNodeId={selectedNodeId}
              resetSignal={resetSignal}
              onSelectNode={selectNode}
            />
            <GraphLegend />
          </div>
        </section>
      </section>

      <aside className="details-panel">
        <NodeDetailsPanel
          response={response}
          selectedDetails={selectedDetails}
          isGeneratingSourceDetails={selectedNodeId ? semanticDetailLoadingIds.has(selectedNodeId) : false}
          sourceDetailsFailed={selectedNodeId ? semanticDetailFailedIds.has(selectedNodeId) : false}
          mermaid={mermaid}
          onClose={() => setSelectedNodeId(undefined)}
        />
      </aside>
    </main>
  );
};

const SidebarBrand = () => (
  <div className="sidebar-brand">
    <span className="brand-mark">
      <Orbit size={25} />
    </span>
    <div>
      <h1>Orbit Atlas</h1>
      <p>Architecture Explorer</p>
    </div>
  </div>
);

const navItems: Array<{ id: WorkspaceSection; label: string; icon: typeof Grid2X2 }> = [
  { id: "overview", label: "Overview", icon: Grid2X2 },
  { id: "architecture", label: "Architecture Map", icon: Network },
  { id: "learning", label: "Learning Path", icon: BookOpen },
  { id: "impact", label: "Impact Analysis", icon: Zap },
  { id: "tests", label: "Test View", icon: TestTube2 }
];

const SidebarNavigation = ({
  activeSection,
  onSelect
}: {
  activeSection: WorkspaceSection;
  onSelect: (section: WorkspaceSection) => void;
}) => (
  <nav className="sidebar-nav" aria-label="Workspace sections">
    {navItems.map((item) => {
      const Icon = item.icon;
      return (
        <button
          key={item.id}
          type="button"
          className={activeSection === item.id ? "active" : ""}
          onClick={() => onSelect(item.id)}
        >
          <Icon size={17} />
          <span>{item.label}</span>
        </button>
      );
    })}
  </nav>
);

const depthLabels = [
  { value: 1, label: "Entry scan", caption: "Fewest nodes" },
  { value: 2, label: "Feature path", caption: "Balanced map" },
  { value: 3, label: "Dependency view", caption: "More edges" },
  { value: 4, label: "Full context", caption: "Most relationships" }
];

const DepthControl = ({
  value,
  loading,
  onChange
}: {
  value: number;
  loading: boolean;
  onChange: (value: number) => void;
}) => (
  <section className="depth-card">
    <div className="panel-heading">
      <span>Depth Sensing</span>
      <strong>{value}</strong>
    </div>
    <div className="depth-rail" role="group" aria-label="Graph depth">
      {depthLabels.map((item) => (
        <button
          key={item.value}
          type="button"
          className={value === item.value ? "active" : ""}
          disabled={loading}
          onClick={() => onChange(item.value)}
        >
          <span>{item.value}</span>
          <div>
            <strong>{item.label}</strong>
            <small>{item.caption}</small>
          </div>
        </button>
      ))}
    </div>
  </section>
);

const GroundingCard = ({
  response,
  loading
}: {
  response?: ArchitectureResponse | undefined;
  loading: boolean;
}) => (
  <section className="system-card">
    <div className="system-heading">
      <span>
        <Shield size={16} />
        Orbit Grounding
      </span>
    </div>
    <p className={loading ? "loading-text" : "healthy"}>{loading ? "Querying Orbit" : "Grounded"}</p>
    <small>{response ? `Generated ${formatGeneratedAt(response.grounding.generatedAt)}` : "Waiting for a map"}</small>
    <dl>
      <div>
        <dt>Provider</dt>
        <dd>{response?.grounding.provider ?? "Orbit"}</dd>
      </div>
      <div>
        <dt>Symbols</dt>
        <dd>{response?.grounding.symbolCount ?? 0}</dd>
      </div>
      <div>
        <dt>Nodes</dt>
        <dd>{response?.nodes.length ?? 0}</dd>
      </div>
      <div>
        <dt>Edges</dt>
        <dd>{response?.edges.length ?? 0}</dd>
      </div>
    </dl>
  </section>
);

const WorkspaceTopBar = ({
  response,
  loading,
  error,
  notice,
  repoUrl,
  onRepoUrlChange,
  onRepoSubmit,
  onAsk,
  onShare,
  onExport
}: {
  response?: ArchitectureResponse | undefined;
  loading: boolean;
  error?: string | undefined;
  notice?: string | undefined;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  onRepoSubmit: () => void;
  onAsk: () => void;
  onShare: () => void;
  onExport: () => void;
}) => (
  <header className="workspace-topbar">
    <form
      className="repo-control"
      onSubmit={(event) => {
        event.preventDefault();
        onRepoSubmit();
      }}
    >
      <label className="sr-only" htmlFor="repo-url-control">
        GitLab repository URL
      </label>
      <GitBranch size={18} />
      <input
        id="repo-url-control"
        value={repoUrl}
        onChange={(event) => onRepoUrlChange(event.target.value)}
        placeholder="https://gitlab.com/group/project"
      />
      <button type="submit" disabled={loading || repoUrl.trim().length === 0}>
        Load
      </button>
    </form>

    <div className="topbar-actions">
      <StatusStrip response={response} loading={loading} error={error} notice={notice} />
      <button className="ask-button" type="button" onClick={onAsk}>
        <Search size={16} />
        Ask Atlas
      </button>
      <button type="button" onClick={onShare} disabled={!response}>
        <Share2 size={16} />
        Share
      </button>
      <button type="button" onClick={onExport} disabled={!response}>
        <Upload size={16} />
        Export
      </button>
    </div>
  </header>
);

const GraphSummaryBar = ({
  response,
  depth,
  showTests
}: {
  response?: ArchitectureResponse | undefined;
  depth: number;
  showTests: boolean;
}) => (
  <div className="graph-summary-bar">
    <span>
      <Layers size={15} />
      Depth {depth}
    </span>
    <span>{response?.nodes.length ?? 0} nodes</span>
    <span>{response?.edges.length ?? 0} relationships</span>
    <span>{response?.grounding.symbolCount ?? 0} Orbit symbols</span>
    <span>{showTests ? "Tests visible" : "Tests hidden"}</span>
  </div>
);

const GraphLegend = () => (
  <div className="graph-legend">
    {(["ui", "controller", "service", "database", "external"] as const).map((type) => (
      <span key={type}>
        <i style={{ background: roleStyles[type].accent }} />
        {roleStyles[type].label}
      </span>
    ))}
    <span>
      <b />
      Relationship
    </span>
    <span>
      <b className="dashed" />
      Test edge
    </span>
  </div>
);

const WorkspaceFocusPanel = ({
  section,
  response,
  selectedDetails,
  selectedNode,
  onSelectLearningPathNode
}: {
  section: WorkspaceSection;
  response?: ArchitectureResponse | undefined;
  selectedDetails?: NodeDetails | undefined;
  selectedNode?: GraphNode | undefined;
  onSelectLearningPathNode: (nodeId: string) => void;
}) => {
  const nodeLabel = selectedDetails?.label ?? selectedNode?.label ?? "selected node";
  const directDependencies = selectedDetails?.dependencies.length ?? 0;
  const dependents = selectedDetails?.dependents.length ?? 0;
  const tests = selectedDetails?.relatedTests.length ?? 0;
  const impactScore = directDependencies + dependents + tests;
  const relatedTests = selectedDetails?.relatedTests ?? [];

  if (section === "architecture") {
    return (
      <section className="workspace-focus architecture-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <Network size={15} />
            Architecture Map
          </span>
          <h2>Explore the grounded relationship map.</h2>
          <p>
            This view keeps the graph front and center. Use the graph toolbar to fit the canvas, show tests,
            expand the selected node, or export the current map.
          </p>
        </div>
        <FocusMetric label="Visible nodes" value={response?.nodes.length ?? 0} />
        <FocusMetric label="Relationships" value={response?.edges.length ?? 0} />
      </section>
    );
  }

  if (section === "learning") {
    return (
      <section className="workspace-focus learning-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <BookOpen size={15} />
            Learning Path
          </span>
          <h2>Read the codebase in the order Orbit Atlas recommends.</h2>
          <p>Each step is selected from the current graph, so clicking a step also changes the selected node panel.</p>
        </div>
        {response ? (
          <div className="focus-learning-path">
            <LearningPath
              steps={response.learningPath}
              selectedNodeId={selectedNode?.id}
              onSelect={onSelectLearningPathNode}
            />
          </div>
        ) : null}
      </section>
    );
  }

  if (section === "impact") {
    return (
      <section className="workspace-focus impact-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <Zap size={15} />
            Impact Analysis
          </span>
          <h2>Estimate what changes if {nodeLabel} changes.</h2>
          <p>Impact is computed from the selected node’s outgoing dependencies, incoming dependents, and related tests.</p>
        </div>
        <div className="metric-triplet">
          <div>
            <strong>{directDependencies}</strong>
            <span>Dependencies</span>
          </div>
          <div>
            <strong>{dependents}</strong>
            <span>Dependents</span>
          </div>
          <div>
            <strong>{impactScore}</strong>
            <span>Total signals</span>
          </div>
        </div>
      </section>
    );
  }

  if (section === "tests") {
    return (
      <section className="workspace-focus tests-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <TestTube2 size={15} />
            Related Test View
          </span>
          <h2>Check the tests Orbit found near {nodeLabel}.</h2>
          <p>
            This view turns test nodes on in the graph. If no related tests appear, the current depth did not return a
            grounded test relationship for the selected node.
          </p>
        </div>
        <div className="test-summary">
          <strong>{tests}</strong>
          <span>{tests === 1 ? "related test" : "related tests"}</span>
          <ul>
            {relatedTests.length > 0 ? (
              relatedTests.map((node) => <li key={node.id}>{node.label}</li>)
            ) : (
              <li>No related tests returned at this depth.</li>
            )}
          </ul>
        </div>
      </section>
    );
  }

  return null;
};

const FocusMetric = ({ label, value }: { label: string; value: number }) => (
  <article className="focus-metric">
    <strong>{value}</strong>
    <span>{label}</span>
  </article>
);

const formatGeneratedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
