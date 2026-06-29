import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchitectureNodeType, ArchitectureResponse, GraphEdge, GraphNode, NodeDetails } from "@navix/shared";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
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
type LoadingOperation = "generate" | "expand";
type ExportMode = "mermaid" | "summary" | "json";
type GraphTypeFilter = "all" | ArchitectureNodeType;
type SavedSession = {
  id: string;
  prompt: string;
  repoUrl?: string | undefined;
  generatedAt: string;
  nodes: number;
  edges: number;
  provider: string;
};
type SavedInvestigation = {
  id: string;
  title: string;
  prompt: string;
  repoUrl?: string | undefined;
  generatedAt: string;
  updatedAt: string;
  selectedNodeId?: string | undefined;
  nodes: number;
  edges: number;
  confidence: NonNullable<NodeDetails["evidence"]>["confidence"] | "n/a";
  reviewedNodeIds: string[];
  notes: string;
};

const defaultPrompt = import.meta.env.VITE_DEFAULT_PROMPT ?? "Explain query schema graph loading.";
const defaultRepoUrl =
  import.meta.env.VITE_DEFAULT_REPO_URL ??
  "https://gitlab.com/gitlab-community/gitlab-org/orbit/knowledge-graph";
const savedSessionsKey = "navix:sessions";
const savedInvestigationsKey = "navix:investigations";
const graphTypeFilters: Array<{ value: GraphTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "api", label: "API" },
  { value: "controller", label: "Controllers" },
  { value: "service", label: "Services" },
  { value: "model", label: "Models" },
  { value: "database", label: "Data" },
  { value: "utility", label: "Utilities" },
  { value: "test", label: "Tests" }
];

const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]) => {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
};

const mergeNodeDetails = (
  existing: Record<string, NodeDetails>,
  incoming: Record<string, NodeDetails>
) => {
  const merged: Record<string, NodeDetails> = { ...existing };

  for (const [nodeId, next] of Object.entries(incoming)) {
    const current = existing[nodeId];
    if (current?.sourceGrounding && !next.sourceGrounding) {
      const currentEvidence = current.evidence;
      const nextEvidence = next.evidence;
      merged[nodeId] = {
        ...next,
        summary: current.summary,
        purpose: current.purpose,
        onboardingNotes: current.onboardingNotes,
        inspectionQuestions: current.inspectionQuestions,
        sourceGrounding: current.sourceGrounding,
        evidence: {
          sourceFile: currentEvidence?.sourceFile ?? nextEvidence?.sourceFile ?? next.filePath,
          snippetLineCount: currentEvidence?.snippetLineCount ?? nextEvidence?.snippetLineCount,
          indexedDefinitionCount:
            nextEvidence?.indexedDefinitionCount ??
            currentEvidence?.indexedDefinitionCount ??
            next.indexedDefinitions?.length ??
            0,
          incomingCount: nextEvidence?.incomingCount ?? currentEvidence?.incomingCount ?? next.dependents.length,
          outgoingCount: nextEvidence?.outgoingCount ?? currentEvidence?.outgoingCount ?? next.dependencies.length,
          relatedTestCount: nextEvidence?.relatedTestCount ?? currentEvidence?.relatedTestCount ?? next.relatedTests.length,
          confidence: currentEvidence?.confidence ?? nextEvidence?.confidence ?? "medium",
          missing: nextEvidence?.missing ?? currentEvidence?.missing ?? []
        },
        relationshipEvidence: next.relationshipEvidence ?? current.relationshipEvidence
      };
    } else {
      merged[nodeId] = next;
    }
  }

  return merged;
};

const preferredSelectedNodeId = (next: ArchitectureResponse) => {
  if (next.prompt.intent === "test_coverage_view") {
    const productionWithTests = next.nodes.find((node) => {
      return node.type !== "test" && (next.nodeDetails[node.id]?.relatedTests.length ?? node.relatedTests?.length ?? 0) > 0;
    });
    if (productionWithTests) {
      return productionWithTests.id;
    }
  }

  return next.learningPath[0]?.nodeId ?? next.nodes.find((node) => node.type !== "test")?.id ?? next.nodes[0]?.id;
};

export const App = () => {
  const [response, setResponse] = useState<ArchitectureResponse>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [showTests, setShowTests] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOperation, setLoadingOperation] = useState<LoadingOperation>("generate");
  const [loadingStartedAt, setLoadingStartedAt] = useState<number>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [lastPrompt, setLastPrompt] = useState(defaultPrompt);
  const [lastRepoUrl, setLastRepoUrl] = useState<string | undefined>(defaultRepoUrl);
  const [draftRepoUrl, setDraftRepoUrl] = useState(defaultRepoUrl);
  const [activeDepth, setActiveDepth] = useState(2);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("overview");
  const [resetSignal, setResetSignal] = useState(0);
  const [mermaid, setMermaid] = useState<string>();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("mermaid");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [graphTypeFilter, setGraphTypeFilter] = useState<GraphTypeFilter>("all");
  const [mapExpanded, setMapExpanded] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [savedInvestigations, setSavedInvestigations] = useState<SavedInvestigation[]>([]);
  const [activeInvestigationId, setActiveInvestigationId] = useState<string>();
  const [semanticDetailLoadingIds, setSemanticDetailLoadingIds] = useState<Set<string>>(new Set());
  const [semanticDetailFailedIds, setSemanticDetailFailedIds] = useState<Set<string>>(new Set());
  const semanticDetailAttempts = useRef(new Set<string>());

  useEffect(() => {
    if (!loading || !loadingStartedAt) {
      setElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStartedAt) / 1000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);

    return () => window.clearInterval(interval);
  }, [loading, loadingStartedAt]);

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

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId || !response) {
      return undefined;
    }
    return response.edges.find((edge) => edge.id === selectedEdgeId);
  }, [response, selectedEdgeId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedSessionsKey);
      if (raw) {
        setSavedSessions(JSON.parse(raw) as SavedSession[]);
      }
    } catch {
      setSavedSessions([]);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedInvestigationsKey);
      if (raw) {
        setSavedInvestigations(JSON.parse(raw) as SavedInvestigation[]);
      }
    } catch {
      setSavedInvestigations([]);
    }
  }, []);

  const rememberSession = (next: ArchitectureResponse) => {
    const session: SavedSession = {
      id: `${next.grounding.generatedAt}:${next.prompt.rawPrompt}`,
      prompt: next.prompt.rawPrompt,
      repoUrl: next.grounding.repoUrl,
      generatedAt: next.grounding.generatedAt,
      nodes: next.nodes.length,
      edges: next.edges.length,
      provider: next.grounding.provider
    };

    setSavedSessions((current) => {
      const deduped = [
        session,
        ...current.filter((item) => {
          return item.prompt !== session.prompt || item.repoUrl !== session.repoUrl || item.provider !== session.provider;
        })
      ].slice(0, 6);
      try {
        window.localStorage.setItem(savedSessionsKey, JSON.stringify(deduped));
      } catch {
        // Local storage is a convenience; the map remains usable without it.
      }
      return deduped;
    });
  };

  const persistInvestigations = (next: SavedInvestigation[]) => {
    try {
      window.localStorage.setItem(savedInvestigationsKey, JSON.stringify(next));
    } catch {
      // Investigation history is local convenience; the current map still works without storage.
    }
  };

  const saveCurrentInvestigation = () => {
    if (!response) {
      return;
    }

    const existing = activeInvestigationId
      ? savedInvestigations.find((item) => item.id === activeInvestigationId)
      : undefined;
    const now = new Date().toISOString();
    const selectedConfidence = selectedDetails?.evidence?.confidence ?? "n/a";
    const investigation: SavedInvestigation = {
      id: existing?.id ?? `${response.grounding.generatedAt}:${response.prompt.rawPrompt}`,
      title: `${response.prompt.feature} investigation`,
      prompt: response.prompt.rawPrompt,
      repoUrl: response.grounding.repoUrl,
      generatedAt: existing?.generatedAt ?? response.grounding.generatedAt,
      updatedAt: now,
      selectedNodeId,
      nodes: response.nodes.length,
      edges: response.edges.length,
      confidence: selectedConfidence,
      reviewedNodeIds: existing?.reviewedNodeIds ?? [],
      notes: existing?.notes ?? ""
    };

    setSavedInvestigations((current) => {
      const next = [investigation, ...current.filter((item) => item.id !== investigation.id)].slice(0, 8);
      persistInvestigations(next);
      return next;
    });
    setActiveInvestigationId(investigation.id);
    setNotice("Investigation saved");
  };

  const markSelectedReviewed = () => {
    if (!response || !selectedNodeId) {
      return;
    }

    const currentId = activeInvestigationId ?? `${response.grounding.generatedAt}:${response.prompt.rawPrompt}`;
    const now = new Date().toISOString();
    const existing = savedInvestigations.find((item) => item.id === currentId);
    const investigation: SavedInvestigation = existing ?? {
      id: currentId,
      title: `${response.prompt.feature} investigation`,
      prompt: response.prompt.rawPrompt,
      repoUrl: response.grounding.repoUrl,
      generatedAt: response.grounding.generatedAt,
      updatedAt: now,
      selectedNodeId,
      nodes: response.nodes.length,
      edges: response.edges.length,
      confidence: selectedDetails?.evidence?.confidence ?? "n/a",
      reviewedNodeIds: [],
      notes: ""
    };
    const reviewedNodeIds = [...new Set([...investigation.reviewedNodeIds, selectedNodeId])];
    const updated = {
      ...investigation,
      updatedAt: now,
      selectedNodeId,
      reviewedNodeIds,
      confidence: selectedDetails?.evidence?.confidence ?? investigation.confidence
    };

    setSavedInvestigations((current) => {
      const next = [updated, ...current.filter((item) => item.id !== updated.id)].slice(0, 8);
      persistInvestigations(next);
      return next;
    });
    setActiveInvestigationId(updated.id);
    setNotice(`${selectedDetails?.label ?? selectedNode?.label ?? "Node"} marked reviewed`);
  };

  const loadArchitecture = async (values: { prompt: string; repoUrl?: string | undefined; depth: number }) => {
    const nextRepoUrl = values.repoUrl?.trim() || undefined;
    setLoading(true);
    setLoadingOperation("generate");
    setLoadingStartedAt(Date.now());
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
      setSelectedNodeId(preferredSelectedNodeId(next));
      setSelectedEdgeId(undefined);
      setLastPrompt(values.prompt);
      setLastRepoUrl(nextRepoUrl);
      setDraftRepoUrl(nextRepoUrl ?? "");
      setActiveDepth(values.depth);
      setResetSignal((value) => value + 1);
      setGraphTypeFilter("all");
      rememberSession(next);
      semanticDetailAttempts.current.clear();
      setSemanticDetailLoadingIds(new Set());
      setSemanticDetailFailedIds(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate architecture map");
    } finally {
      setLoading(false);
      setLoadingStartedAt(undefined);
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
    setSelectedEdgeId(undefined);

    if (!response) {
      return;
    }

    await fetchSourceGroundedDetails(node.id, response);
  };

  const selectEdge = (edge: GraphEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(edge.target);
    const node = response?.nodes.find((candidate) => candidate.id === edge.target);
    if (node && response) {
      void fetchSourceGroundedDetails(node.id, response);
    }
  };

  const selectLearningPathNode = (nodeId: string) => {
    const node = response?.nodes.find((candidate) => candidate.id === nodeId);
    if (node) {
      void selectNode(node);
    }
  };

  const loadSavedSession = (session: SavedSession) => {
    void loadArchitecture({
      prompt: session.prompt,
      repoUrl: session.repoUrl,
      depth: activeDepth
    });
  };

  const loadSavedInvestigation = (investigation: SavedInvestigation) => {
    setActiveInvestigationId(investigation.id);
    void loadArchitecture({
      prompt: investigation.prompt,
      repoUrl: investigation.repoUrl,
      depth: activeDepth
    });
  };

  const expandSelected = async () => {
    if (!selectedNodeId || !response) {
      return;
    }

    setLoading(true);
    setLoadingOperation("expand");
    setLoadingStartedAt(Date.now());
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

      const nextResponse = {
        ...response,
        nodes: mergeById(response.nodes, expansion.nodes),
        edges: mergeById(response.edges, expansion.edges),
        nodeDetails: mergeNodeDetails(response.nodeDetails, expansion.nodeDetails),
        learningPath: expansion.learningPath.length > 0 ? expansion.learningPath : response.learningPath,
        grounding: expansion.grounding
      };

      setResponse(nextResponse);
      rememberSession(nextResponse);
      setResetSignal((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to expand selected node");
    } finally {
      setLoading(false);
      setLoadingStartedAt(undefined);
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
      setExportModalOpen(true);
      setExportMode("mermaid");
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
      "Navix map",
      `Prompt: ${response.prompt.rawPrompt}`,
      `Repository: ${response.grounding.repoUrl ?? "not set"}`,
      `Depth: ${response.prompt.depth}`,
      `Nodes: ${response.nodes.length}`,
      `Edges: ${response.edges.length}`,
      "",
      "Next actions:",
      ...buildActionItems(response, selectedDetails, selectedNode).map((item) => `- ${item.label}: ${item.detail}`)
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
      setGraphTypeFilter("test");
      if (response) {
        const productionWithTests = response.nodes.find((node) => {
          return node.type !== "test" && (response.nodeDetails[node.id]?.relatedTests.length ?? node.relatedTests?.length ?? 0) > 0;
        });
        if (productionWithTests) {
          setSelectedNodeId(productionWithTests.id);
          setSelectedEdgeId(undefined);
          void fetchSourceGroundedDetails(productionWithTests.id, response);
        }
      }
    }
    if (section === "architecture") {
      setGraphTypeFilter("all");
      setResetSignal((value) => value + 1);
    } else {
      setMapExpanded(false);
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

    const nodes = response.nodes.filter((node) => {
      const passesTestVisibility = showTests || node.type !== "test";
      const passesTypeFilter = graphTypeFilter === "all" || node.type === graphTypeFilter;
      return passesTestVisibility && passesTypeFilter;
    });
    const visibleIds = new Set(nodes.map((node) => node.id));

    return {
      nodes,
      edges: response.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    };
  }, [graphTypeFilter, response, showTests]);
  const showsGraphCanvas = activeSection === "architecture";

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
          operation={loadingOperation}
          elapsedSeconds={elapsedSeconds}
          error={error}
          notice={notice}
          repoUrl={draftRepoUrl}
          onRepoUrlChange={setDraftRepoUrl}
          onRepoSubmit={handleRepoSubmit}
          onAsk={focusPrompt}
          onShare={handleShare}
          onExport={handleExport}
        />

        <section
          className={`architecture-surface ${showsGraphCanvas ? "map-surface" : "insight-surface"} ${mapExpanded ? "map-expanded" : ""} ${loading ? "loading-active" : ""}`}
          id="overview"
        >
          {!mapExpanded ? (
            <PromptInput
              initialPrompt={defaultPrompt}
              repoUrl={draftRepoUrl}
              depth={activeDepth}
              loading={loading}
              onSubmit={loadArchitecture}
            />
          ) : null}

          {!mapExpanded ? (
            <WorkspaceFocusPanel
              section={activeSection}
              response={response}
              selectedDetails={selectedDetails}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              savedSessions={savedSessions}
              savedInvestigations={savedInvestigations}
              activeInvestigationId={activeInvestigationId}
              onSelectLearningPathNode={selectLearningPathNode}
              onLoadSavedSession={loadSavedSession}
              onLoadSavedInvestigation={loadSavedInvestigation}
              onSaveInvestigation={saveCurrentInvestigation}
              onMarkReviewed={markSelectedReviewed}
              onNavigate={navigateTo}
            />
          ) : null}

          {showsGraphCanvas ? (
            <div className="graph-action-row">
              <div className="graph-action-stack">
                <GraphSummaryBar
                  visibleNodeCount={visibleGraph.nodes.length}
                  visibleEdgeCount={visibleGraph.edges.length}
                  depth={activeDepth}
                  showTests={showTests}
                />
                <GraphFilterBar
                  value={graphTypeFilter}
                  response={response}
                  onChange={(value) => {
                    setGraphTypeFilter(value);
                    if (value === "test") {
                      setShowTests(true);
                    }
                    setResetSignal((current) => current + 1);
                  }}
                />
              </div>
              <GraphToolbar
                showTests={showTests}
                hasSelection={Boolean(selectedNodeId)}
                loading={loading}
                onResetView={() => setResetSignal((value) => value + 1)}
                onToggleTests={() => setShowTests((value) => !value)}
                onExpandSelected={expandSelected}
                onExportMermaid={handleExport}
                expanded={mapExpanded}
                onToggleExpanded={() => {
                  setMapExpanded((value) => !value);
                  setResetSignal((value) => value + 1);
                }}
              />
            </div>
          ) : null}

          {error ? (
            <div className="graph-error" role="alert">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}

          {loading ? (
            <LoadingProgressPanel operation={loadingOperation} elapsedSeconds={elapsedSeconds} response={response} />
          ) : null}

          {showsGraphCanvas ? (
            <div className="graph-stage" id="architecture-map">
              <ArchitectureGraph
                nodes={visibleGraph.nodes}
                edges={visibleGraph.edges}
                showTests={showTests}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                resetSignal={resetSignal}
                onSelectNode={selectNode}
                onSelectEdge={selectEdge}
              />
              <GraphLegend />
            </div>
          ) : null}
        </section>
      </section>

      <aside className="details-panel">
        <NodeDetailsPanel
          response={response}
          selectedDetails={selectedDetails}
          isGeneratingSourceDetails={selectedNodeId ? semanticDetailLoadingIds.has(selectedNodeId) : false}
          sourceDetailsFailed={selectedNodeId ? semanticDetailFailedIds.has(selectedNodeId) : false}
          mermaid={undefined}
          onClose={() => {
            setSelectedNodeId(undefined);
            setSelectedEdgeId(undefined);
          }}
        />
      </aside>

      {exportModalOpen && response ? (
        <ExportModal
          response={response}
          mermaid={mermaid}
          mode={exportMode}
          onModeChange={setExportMode}
          onClose={() => setExportModalOpen(false)}
        />
      ) : null}
    </main>
  );
};

const SidebarBrand = () => (
  <div className="sidebar-brand">
    <span className="brand-mark">
      <Orbit size={25} />
    </span>
    <div>
      <h1>Navix</h1>
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
  { value: 1, label: "Scan" },
  { value: 2, label: "Path" },
  { value: 3, label: "Context" },
  { value: 4, label: "Deep" }
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
      <span>Depth</span>
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
}) => {
  const hasNoData = Boolean(response && response.nodes.length === 0);
  const status = loading ? "Querying Orbit" : hasNoData ? "No graph data" : "Grounded";

  return (
    <section className="system-card">
      <div className="system-heading">
        <span>
          <Shield size={16} />
          Orbit Grounding
        </span>
      </div>
      <p className={loading ? "loading-text" : hasNoData ? "warning-text" : "healthy"}>{status}</p>
      {hasNoData && response?.grounding.limitations[0] ? (
        <small className="grounding-warning">{response.grounding.limitations[0]}</small>
      ) : null}
      <dl>
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
};

const WorkspaceTopBar = ({
  response,
  loading,
  operation,
  elapsedSeconds,
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
  operation: LoadingOperation;
  elapsedSeconds: number;
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
      <StatusStrip
        response={response}
        loading={loading}
        operation={operation}
        elapsedSeconds={elapsedSeconds}
        error={error}
        notice={notice}
      />
      <button className="ask-button" type="button" onClick={onAsk}>
        <Search size={16} />
        Ask Navix
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
  visibleNodeCount,
  visibleEdgeCount,
  depth,
  showTests
}: {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  depth: number;
  showTests: boolean;
}) => (
  <div className="graph-summary-bar">
    <span>
      <Layers size={15} />
      Depth {depth}
    </span>
    <span>{visibleNodeCount} visible nodes</span>
    <span>{visibleEdgeCount} visible relationships</span>
    {showTests ? <span>Tests visible</span> : null}
  </div>
);

const GraphFilterBar = ({
  value,
  response,
  onChange
}: {
  value: GraphTypeFilter;
  response?: ArchitectureResponse | undefined;
  onChange: (value: GraphTypeFilter) => void;
}) => {
  const counts = new Map<GraphTypeFilter, number>([["all", response?.nodes.length ?? 0]]);
  for (const node of response?.nodes ?? []) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return (
    <div className="graph-filter-bar" aria-label="Filter visible map">
      {graphTypeFilters.map((item) => {
        const count = counts.get(item.value) ?? 0;
        const disabled = !response || count === 0;
        return (
          <button
            key={item.value}
            type="button"
            className={value === item.value ? "active" : ""}
            disabled={disabled}
            onClick={() => onChange(item.value)}
          >
            {item.label}
            <span>{count}</span>
          </button>
        );
      })}
    </div>
  );
};

const GraphLegend = () => (
  <div className="graph-legend">
    {(["ui", "api", "controller", "service", "model", "database", "utility", "test", "external"] as const).map((type) => (
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
  selectedEdge,
  savedSessions,
  savedInvestigations,
  activeInvestigationId,
  onSelectLearningPathNode,
  onLoadSavedSession,
  onLoadSavedInvestigation,
  onSaveInvestigation,
  onMarkReviewed,
  onNavigate
}: {
  section: WorkspaceSection;
  response?: ArchitectureResponse | undefined;
  selectedDetails?: NodeDetails | undefined;
  selectedNode?: GraphNode | undefined;
  selectedEdge?: GraphEdge | undefined;
  savedSessions: SavedSession[];
  savedInvestigations: SavedInvestigation[];
  activeInvestigationId?: string | undefined;
  onSelectLearningPathNode: (nodeId: string) => void;
  onLoadSavedSession: (session: SavedSession) => void;
  onLoadSavedInvestigation: (investigation: SavedInvestigation) => void;
  onSaveInvestigation: () => void;
  onMarkReviewed: () => void;
  onNavigate: (section: WorkspaceSection) => void;
}) => {
  const nodeLabel = selectedDetails?.label ?? selectedNode?.label ?? "selected node";
  const directDependencies = selectedDetails?.dependencies.length ?? 0;
  const dependents = selectedDetails?.dependents.length ?? 0;
  const tests = selectedDetails?.relatedTests.length ?? 0;
  const impactScore = directDependencies + dependents + tests;
  const relatedTests = selectedDetails?.relatedTests ?? [];
  const learningSteps = response ? buildDailyLearningPath(response, selectedDetails) : [];
  const testSearchTerms = buildTestSearchTerms(selectedDetails, selectedNode);
  const risk = riskLevel(impactScore);
  const actionItems = buildActionItems(response, selectedDetails, selectedNode);
  const topTests = buildTestActions(selectedDetails, selectedNode);
  const activeInvestigation = activeInvestigationId
    ? savedInvestigations.find((item) => item.id === activeInvestigationId)
    : undefined;

  if (section === "overview") {
    const topNodes = response?.nodes
      .slice()
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 3) ?? [];

    return (
      <section className="workspace-focus overview-focus" id="workspace-focus">
        <div className="overview-hero">
          <span className="focus-eyebrow">
            <Grid2X2 size={15} />
            Overview
          </span>
          <h2>
            {response
              ? `${response.nodes.length} nodes mapped for ${response.prompt.feature}`
              : "Ask a code-path question to build a grounded map."}
          </h2>
          <p>
            {response?.overview ??
              "Generate a map to see the critical files, relationships, and next actions."}
          </p>
        </div>
        <div className="overview-dashboard">
          <div className="overview-dashboard-heading">
            <strong>Map snapshot</strong>
            <span>{response?.grounding.provider ?? "No provider"}</span>
          </div>
          <div>
            <strong>{response?.nodes.length ?? 0}</strong>
            <span>mapped nodes</span>
          </div>
          <div>
            <strong>{response?.edges.length ?? 0}</strong>
            <span>relationships</span>
          </div>
          <div>
            <strong>{selectedDetails?.evidence?.confidence ?? "n/a"}</strong>
            <span>selected confidence</span>
          </div>
        </div>
        <div className="overview-list">
          <strong>Read first</strong>
          {topNodes.length > 0 ? (
            topNodes.map((node) => <span key={node.id}>{node.label}</span>)
          ) : (
            <span>Waiting for graph data</span>
          )}
        </div>
        <ActionPlanCard actions={actionItems} onNavigate={onNavigate} />
        <InvestigationCard
          response={response}
          selectedLabel={nodeLabel}
          activeInvestigation={activeInvestigation}
          onSave={onSaveInvestigation}
          onMarkReviewed={onMarkReviewed}
        />
      </section>
    );
  }

  if (section === "architecture") {
    return (
      <section className="workspace-focus architecture-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <Network size={15} />
            Architecture Map
          </span>
          <h2>Explore the grounded relationship map.</h2>
        </div>
        {selectedEdge ? <EdgeEvidenceCard edge={selectedEdge} response={response} /> : null}
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
          <h2>Read the codebase in the order Navix recommends.</h2>
        </div>
        {response ? (
          <div className="focus-learning-path">
            <LearningPath
              steps={learningSteps}
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
        <div className="risk-notes">
          <strong>{risk} visible risk</strong>
          <span>
            {dependents > 0
              ? `${dependents} upstream node${dependents === 1 ? "" : "s"} may rely on this behavior.`
              : "No upstream dependent appeared in the current graph."}
          </span>
          <span>
            {directDependencies > 0
              ? `Review ${selectedDetails?.dependencies.slice(0, 2).map((node) => node.label).join(", ")} before editing.`
              : "Increase depth if you need the next hop beyond this node."}
          </span>
          <span>{tests > 0 ? `${tests} related test signal${tests === 1 ? "" : "s"} found.` : "No related test signal appeared; verify manually before editing."}</span>
        </div>
        <ActionChecklist title="Before editing" items={buildImpactChecklist(selectedDetails, nodeLabel)} />
      </section>
    );
  }

  if (section === "tests") {
    const testPlan = buildTestPlan(selectedDetails, selectedNode);

    return (
      <section className="workspace-focus tests-focus" id="workspace-focus">
        <div>
          <span className="focus-eyebrow">
            <TestTube2 size={15} />
            Related Test View
          </span>
          <h2>Check the tests Orbit found near {nodeLabel}.</h2>
        </div>
        <TestPlanCard plan={testPlan} />
        <div className="test-summary related-test-card">
          <strong>{tests}</strong>
          <span>{tests === 1 ? "confirmed related test" : "confirmed related tests"}</span>
          <ul>
            {relatedTests.length > 0 ? (
              relatedTests.map((node) => (
                <li key={node.id}>
                  <TestTube2 size={15} />
                  <div>
                    <b>{node.label}</b>
                    <small>{node.filePath ?? "Test relationship from graph evidence"}</small>
                  </div>
                </li>
              ))
            ) : (
              <>
                <li>
                  <AlertCircle size={15} />
                  <div>
                    <b>No confirmed test link</b>
                    <small>No related tests returned at this depth.</small>
                  </div>
                </li>
                {testSearchTerms.map((term) => (
                  <li key={term}>
                    <Search size={15} />
                    <div>
                      <b>Search</b>
                      <small>{term}</small>
                    </div>
                  </li>
                ))}
                <li>
                  <CheckCircle2 size={15} />
                  <div>
                    <b>Add coverage around</b>
                    <small>{testSearchTerms.slice(0, 2).join(", ") || nodeLabel}</small>
                  </div>
                </li>
              </>
            )}
          </ul>
        </div>
        <ActionChecklist title="Test actions" items={topTests} />
      </section>
    );
  }

  return null;
};

const EdgeEvidenceCard = ({
  edge,
  response
}: {
  edge: GraphEdge;
  response?: ArchitectureResponse | undefined;
}) => {
  const source = response?.nodes.find((node) => node.id === edge.source);
  const target = response?.nodes.find((node) => node.id === edge.target);

  return (
    <article className="edge-evidence-card">
      <span>
        <GitBranch size={14} />
        Selected Edge
      </span>
      <strong>
        {source?.label ?? edge.source} {"->"} {target?.label ?? edge.target}
      </strong>
      <small>{edge.evidence?.detail ?? edge.label}</small>
      <em>{edge.evidence?.source ?? edge.type}</em>
    </article>
  );
};

const RecentSessions = ({ sessions, onLoad }: { sessions: SavedSession[]; onLoad: (session: SavedSession) => void }) => (
  <div className="recent-sessions">
    <strong>Recent maps</strong>
    {sessions.length > 0 ? (
      sessions.slice(0, 3).map((session) => (
        <button key={session.id} type="button" onClick={() => onLoad(session)}>
          <span>{session.prompt}</span>
          <small>
            {session.nodes} nodes · {session.edges} edges · {formatGeneratedAt(session.generatedAt)}
          </small>
        </button>
      ))
    ) : (
      <div>
        <span>No saved map yet</span>
        <small>Successful maps will appear here automatically.</small>
      </div>
    )}
  </div>
);

const BriefingCard = ({
  briefing
}: {
  briefing: Array<{ label: string; value: string }>;
}) => (
  <div className="briefing-card">
    <strong>Project briefing</strong>
    {briefing.map((item) => (
      <div key={item.label}>
        <span>{item.label}</span>
        <p>{item.value}</p>
      </div>
    ))}
  </div>
);

const EvidenceHealthCard = ({
  health
}: {
  health: Array<{ label: string; value: string; tone: "good" | "warn" | "neutral" }>;
}) => (
  <div className="evidence-health-card">
    <strong>Evidence health</strong>
    {health.map((item) => (
      <div key={item.label}>
        <span>{item.label}</span>
        <em className={`tone-${item.tone}`}>{item.value}</em>
      </div>
    ))}
  </div>
);

const InvestigationCard = ({
  response,
  selectedLabel,
  activeInvestigation,
  onSave,
  onMarkReviewed
}: {
  response?: ArchitectureResponse | undefined;
  selectedLabel: string;
  activeInvestigation?: SavedInvestigation | undefined;
  onSave: () => void;
  onMarkReviewed: () => void;
}) => (
  <div className="investigation-card">
    <strong>Current investigation</strong>
    <div className="investigation-stats">
      <span>{activeInvestigation?.reviewedNodeIds.length ?? 0}</span>
      <small>reviewed files</small>
    </div>
    <div className="investigation-actions">
      <button type="button" disabled={!response} onClick={onSave}>
        {activeInvestigation ? "Saved" : "Save"}
      </button>
      <button type="button" disabled={!response} onClick={onMarkReviewed}>
        Mark {selectedLabel} reviewed
      </button>
    </div>
  </div>
);

const SavedInvestigations = ({
  investigations,
  onLoad
}: {
  investigations: SavedInvestigation[];
  onLoad: (investigation: SavedInvestigation) => void;
}) => (
  <div className="saved-investigations">
    <strong>Saved investigations</strong>
    {investigations.length > 0 ? (
      investigations.slice(0, 4).map((investigation) => (
        <button key={investigation.id} type="button" onClick={() => onLoad(investigation)}>
          <span>{investigation.title}</span>
          <small>
            {investigation.nodes} nodes · {investigation.reviewedNodeIds.length} reviewed · {formatGeneratedAt(investigation.updatedAt)}
          </small>
        </button>
      ))
    ) : (
      <div>
        <span>No investigation saved</span>
        <small>Save one after generating a useful map.</small>
      </div>
    )}
  </div>
);

const ActionPlanCard = ({
  actions,
  onNavigate
}: {
  actions: Array<{ label: string; detail: string; section: WorkspaceSection }>;
  onNavigate: (section: WorkspaceSection) => void;
}) => (
  <div className="action-plan-card">
    <strong>Next best actions</strong>
    {actions.map((action) => (
      <button key={`${action.section}:${action.label}`} type="button" onClick={() => onNavigate(action.section)}>
        <span>{action.label}</span>
        <small>{action.detail}</small>
      </button>
    ))}
  </div>
);

const ActionChecklist = ({ title, items }: { title: string; items: string[] }) => (
  <div className="action-checklist">
    <strong>{title}</strong>
    <ul>
      {items.map((item) => (
        <li key={item}>
          <CheckCircle2 size={14} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

const TestPlanCard = ({
  plan
}: {
  plan: {
    command: string;
    candidateFiles: string[];
    coverageGaps: string[];
    assertions: string[];
  };
}) => (
  <div className="test-plan-card">
    <strong>Test plan</strong>
    <div>
      <span>Likely command</span>
      <code>{plan.command}</code>
    </div>
    <div>
      <span>Candidate files</span>
      {plan.candidateFiles.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
    <div>
      <span>Coverage gaps</span>
      {plan.coverageGaps.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
    <div>
      <span>Suggested assertions</span>
      {plan.assertions.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
  </div>
);

const ExportModal = ({
  response,
  mermaid,
  mode,
  onModeChange,
  onClose
}: {
  response: ArchitectureResponse;
  mermaid?: string | undefined;
  mode: ExportMode;
  onModeChange: (mode: ExportMode) => void;
  onClose: () => void;
}) => {
  const exportText = exportPayload(response, mermaid, mode);

  const copy = async () => {
    await navigator.clipboard?.writeText(exportText);
  };

  return (
    <div className="export-backdrop" role="presentation">
      <section className="export-modal" role="dialog" aria-modal="true" aria-label="Export map">
        <header>
          <div>
            <span>
              <Download size={16} />
              Export Map
            </span>
            <h2>{response.prompt.feature}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close export modal">
            ×
          </button>
        </header>
        <div className="export-tabs" role="tablist" aria-label="Export format">
          {(["mermaid", "summary", "json"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={mode === item ? "active" : ""}
              onClick={() => onModeChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <pre>{exportText}</pre>
        <footer>
          <button type="button" onClick={copy}>
            <Clipboard size={15} />
            Copy
          </button>
          <button type="button" onClick={onClose}>
            <CheckCircle2 size={15} />
            Done
          </button>
        </footer>
      </section>
    </div>
  );
};

const exportPayload = (response: ArchitectureResponse, mermaid: string | undefined, mode: ExportMode) => {
  if (mode === "json") {
    return JSON.stringify(
      {
        prompt: response.prompt,
        nodes: response.nodes,
        edges: response.edges,
        grounding: response.grounding
      },
      null,
      2
    );
  }

  if (mode === "summary") {
    return [
      `Navix: ${response.prompt.rawPrompt}`,
      `Repository: ${response.grounding.repoUrl ?? "not set"}`,
      `Provider: ${response.grounding.provider}`,
      `Map: ${response.nodes.length} nodes, ${response.edges.length} relationships`,
      "",
      response.overview,
      "",
      "Action plan:",
      ...buildActionItems(response, response.nodeDetails[response.learningPath[0]?.nodeId ?? response.nodes[0]?.id ?? ""])
        .map((item) => `- ${item.label}: ${item.detail}`),
      "",
      "Top nodes:",
      ...response.nodes
        .slice()
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 5)
        .map((node) => `- ${node.label} (${node.type})${node.filePath ? `: ${node.filePath}` : ""}`)
    ].join("\n");
  }

  return mermaid ?? "Mermaid export is not ready yet.";
};

const buildProjectBriefing = (
  response?: ArchitectureResponse | undefined,
  details?: NodeDetails | undefined,
  node?: GraphNode | undefined
) => {
  const primaryNode = details?.label ?? node?.label ?? response?.nodes[0]?.label ?? "No node selected";
  const primaryFile = details?.filePath ?? node?.filePath ?? response?.nodes.find((item) => item.filePath)?.filePath ?? "No source file yet";
  const topDependency = details?.dependencies[0]?.label ?? response?.edges[0]?.label ?? "No direct dependency surfaced";
  const firstRelatedTest = details?.relatedTests[0];
  const nextAction = firstRelatedTest
    ? `Inspect ${firstRelatedTest.label} before changing ${primaryNode}.`
    : `Follow the learning path, then add or locate coverage around ${primaryNode}.`;

  return [
    { label: "Slice purpose", value: response?.overview ?? "Ask a prompt to generate a project briefing." },
    { label: "Primary file", value: primaryFile },
    { label: "Key relationship", value: topDependency },
    { label: "Recommended next move", value: nextAction }
  ];
};

const buildEvidenceHealth = (response?: ArchitectureResponse | undefined, details?: NodeDetails | undefined) => {
  const confidence = details?.evidence?.confidence ?? "n/a";
  const missingCount = details?.evidence?.missing.length ?? 0;
  const edgeCount = response?.edges.length ?? 0;
  const relatedTests = details?.relatedTests.length ?? 0;

  return [
    {
      label: "Confidence",
      value: confidence,
      tone: confidence === "high" ? "good" : confidence === "n/a" ? "neutral" : "warn"
    },
    {
      label: "Relationships",
      value: `${edgeCount} edge${edgeCount === 1 ? "" : "s"}`,
      tone: edgeCount > 0 ? "good" : "warn"
    },
    {
      label: "Test evidence",
      value: relatedTests > 0 ? `${relatedTests} found` : "missing",
      tone: relatedTests > 0 ? "good" : "warn"
    },
    {
      label: "Unknowns",
      value: missingCount > 0 ? `${missingCount} signal${missingCount === 1 ? "" : "s"}` : "clear",
      tone: missingCount > 0 ? "warn" : "good"
    }
  ] satisfies Array<{ label: string; value: string; tone: "good" | "warn" | "neutral" }>;
};

const buildActionItems = (
  response?: ArchitectureResponse | undefined,
  details?: NodeDetails | undefined,
  node?: GraphNode | undefined
) => {
  const selectedLabel = details?.label ?? node?.label ?? response?.nodes[0]?.label ?? "the selected node";
  const hasTests = (details?.relatedTests.length ?? 0) > 0;
  const actions: Array<{ label: string; detail: string; section: WorkspaceSection }> = [
    {
      label: "Read the critical path",
      detail: response?.learningPath[0]?.label
        ? `Start with ${response.learningPath[0].label}, then follow the recommended sequence.`
        : "Generate a graph, then use the learning path as your first reading order.",
      section: "learning"
    },
    {
      label: "Check change blast radius",
      detail: `Review dependencies and dependents before changing ${selectedLabel}.`,
      section: "impact"
    },
    {
      label: hasTests ? "Run nearby tests" : "Find missing coverage",
      detail: hasTests
        ? `${details?.relatedTests.length ?? 0} related test signal${details?.relatedTests.length === 1 ? "" : "s"} found.`
        : `No related test signal is attached to ${selectedLabel} yet.`,
      section: "tests"
    }
  ];

  return actions;
};

const buildTestPlan = (details?: NodeDetails | undefined, node?: GraphNode | undefined) => {
  const path = details?.filePath ?? node?.filePath ?? "";
  const label = details?.label ?? node?.label ?? "selected node";
  const terms = buildTestSearchTerms(details, node);
  const primaryTerm = terms[0] ?? label;
  const relatedTests = details?.relatedTests.map((item) => item.filePath ?? item.label).filter(Boolean) ?? [];
  const candidateFiles = relatedTests.length > 0 ? relatedTests.slice(0, 3) : inferTestFiles(path, label);
  const command = inferTestCommand(path, primaryTerm);

  return {
    command,
    candidateFiles,
    coverageGaps: [
      relatedTests.length > 0
        ? "Confirm the related test covers the behavior you plan to edit, not only the file name."
        : "No direct test relationship was returned for this node.",
      `Add a regression case for ${terms.slice(0, 2).join(" and ") || label}.`
    ],
    assertions: [
      `Expected behavior for ${primaryTerm} stays stable after the change.`,
      "Invalid or edge-case input fails in a controlled way.",
      "Downstream callers keep receiving the same shape of data."
    ]
  };
};

const inferTestFiles = (filePath: string, label: string) => {
  if (!filePath) {
    return [`Search for ${label} in the test suite`, `Create a focused ${label} regression test`];
  }
  const normalized = filePath.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() ?? label;
  const baseName = fileName.replace(/\.[^.]+$/, "");

  if (normalized.endsWith(".rs")) {
    return [
      normalized.replace("/src/", "/tests/").replace(/\.rs$/, "_test.rs"),
      `${normalized} #[cfg(test)] module`,
      `tests/${baseName}_test.rs`
    ];
  }
  if (/\.(ts|tsx|js|jsx)$/.test(normalized)) {
    return [
      normalized.replace(/\/src\//, "/__tests__/").replace(/\.(tsx|ts|jsx|js)$/, ".test.$1"),
      normalized.replace(/\.(tsx|ts|jsx|js)$/, ".test.$1"),
      `__tests__/${baseName}.test.ts`
    ];
  }
  return [`tests/${baseName}.test`, `Search tests for ${baseName}`];
};

const inferTestCommand = (filePath: string, term: string) => {
  if (filePath.endsWith(".rs")) {
    return `cargo test ${term}`;
  }
  if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
    return `npm test -- ${term}`;
  }
  if (filePath.endsWith(".py")) {
    return `pytest -k ${term}`;
  }
  return `Search the test runner for ${term}`;
};

const buildImpactChecklist = (details: NodeDetails | undefined, nodeLabel: string) => {
  const dependencies = details?.dependencies.slice(0, 2).map((item) => item.label) ?? [];
  const dependents = details?.dependents.slice(0, 2).map((item) => item.label) ?? [];
  const tests = details?.relatedTests.slice(0, 2).map((item) => item.label) ?? [];

  return [
    dependencies.length > 0
      ? `Open dependency ${dependencies.join(" and ")} before editing ${nodeLabel}.`
      : `Increase depth if ${nodeLabel} has behavior hidden behind another hop.`,
    dependents.length > 0
      ? `Check dependent ${dependents.join(" and ")} for call-site assumptions.`
      : "Search the codebase for direct call sites if no dependents appear.",
    tests.length > 0
      ? `Run or inspect ${tests.join(" and ")} before merging.`
      : "Add a focused regression test before making a risky change."
  ];
};

const buildTestActions = (details?: NodeDetails | undefined, node?: GraphNode | undefined) => {
  const related = details?.relatedTests.slice(0, 2).map((item) => item.label) ?? [];
  const terms = buildTestSearchTerms(details, node);
  const nodeLabel = details?.label ?? node?.label ?? "the selected node";

  if (related.length > 0) {
    return [
      `Run the closest related test: ${related[0]}.`,
      related[1] ? `Review adjacent coverage in ${related[1]}.` : `Search for assertions around ${terms[0] ?? nodeLabel}.`,
      `Add one regression case for the behavior you plan to change in ${nodeLabel}.`
    ];
  }

  return [
    `Search tests for ${terms[0] ?? nodeLabel}.`,
    `Create coverage around ${terms.slice(0, 2).join(" and ") || nodeLabel}.`,
    "Re-run the map at depth 3 if test relationships still do not appear."
  ];
};

const buildDailyLearningPath = (response: ArchitectureResponse, selectedDetails?: NodeDetails | undefined) => {
  const seeded = response.learningPath.length > 1
    ? response.learningPath
    : response.nodes
        .slice()
        .sort((a, b) => {
          const aDegree = response.edges.filter((edge) => edge.source === a.id || edge.target === a.id).length;
          const bDegree = response.edges.filter((edge) => edge.source === b.id || edge.target === b.id).length;
          return (bDegree - aDegree) || (b.importanceScore - a.importanceScore);
        })
        .slice(0, 5)
        .map((node, index) => ({
          order: index + 1,
          nodeId: node.id,
          label: node.label,
          reason: learningReasonForNode(node, response.edges, index)
        }));

  if (selectedDetails && !seeded.some((step) => step.nodeId === selectedDetails.id)) {
    return [
      ...seeded.slice(0, 4),
      {
        order: Math.min(seeded.length + 1, 5),
        nodeId: selectedDetails.id,
        label: selectedDetails.label,
        reason: "Include the selected node so the reading plan stays tied to your current investigation."
      }
    ].map((step, index) => ({ ...step, order: index + 1 }));
  }

  return seeded.map((step, index) => ({ ...step, order: index + 1 }));
};

const learningReasonForNode = (node: GraphNode, edges: GraphEdge[], index: number) => {
  const strongestIncoming = edges.find((edge) => edge.target === node.id);
  const strongestOutgoing = edges.find((edge) => edge.source === node.id);

  if (index === 0) {
    return node.tags?.includes("entrypoint")
      ? "Start here because Orbit tagged it as the entry point for this question."
      : "Start here because it has the strongest match and relationship signal in the returned graph.";
  }
  const incoming = edges.filter((edge) => edge.target === node.id).length;
  const outgoing = edges.filter((edge) => edge.source === node.id).length;
  if (incoming > 0 && outgoing > 0) {
    return `Read next because it bridges ${incoming} incoming and ${outgoing} outgoing relationship${outgoing === 1 ? "" : "s"}.`;
  }
  if (incoming > 0) {
    return strongestIncoming
      ? `Read this to understand the upstream ${strongestIncoming.type} edge: ${strongestIncoming.label}.`
      : "Read this to understand what upstream nodes expect from it.";
  }
  if (strongestOutgoing) {
    return `Read this before following its ${strongestOutgoing.type} edge.`;
  }
  return `Use this ${node.type} node as surrounding context for the requested code path.`;
};

const riskLevel = (score: number) => {
  if (score >= 5) {
    return "High";
  }
  if (score >= 2) {
    return "Medium";
  }
  return "Low";
};

const buildTestSearchTerms = (details?: NodeDetails | undefined, node?: GraphNode | undefined) => {
  const terms = [
    details?.label ?? node?.label,
    ...(details?.indexedDefinitions ?? []).slice(0, 4),
    ...(details?.dependencies ?? []).map((item) => item.label).slice(0, 2)
  ].filter((value): value is string => Boolean(value && value.trim().length > 1));

  return [...new Set(terms)].slice(0, 5);
};

const loadingSteps: Record<LoadingOperation, Array<{ threshold: number; label: string; shortLabel: string; detail: string }>> = {
  generate: [
    { threshold: 0, label: "Connecting to Orbit", shortLabel: "Connect", detail: "Checking repository access and graph provider state." },
    { threshold: 8, label: "Finding matching files", shortLabel: "Match", detail: "Searching definitions, paths, and feature terms." },
    { threshold: 20, label: "Building relationships", shortLabel: "Map", detail: "Ranking nodes and reducing the map to a readable path." },
    { threshold: 36, label: "Preparing explanations", shortLabel: "Explain", detail: "The map can appear before source summaries finish." },
    { threshold: 55, label: "Still working", shortLabel: "Wait", detail: "Large repositories can take longer. You can keep waiting or try a broader prompt." }
  ],
  expand: [
    { threshold: 0, label: "Expanding selected node", shortLabel: "Select", detail: "Keeping the current map visible while Orbit searches nearby code." },
    { threshold: 8, label: "Finding neighbors", shortLabel: "Near", detail: "Looking for imports, calls, and files around the selected node." },
    { threshold: 20, label: "Merging graph context", shortLabel: "Merge", detail: "New nodes will be added without discarding the current explanation." },
    { threshold: 45, label: "Still expanding", shortLabel: "Wait", detail: "This can take about a minute on remote graph queries." }
  ]
};

const LoadingProgressPanel = ({
  operation,
  elapsedSeconds,
  response
}: {
  operation: LoadingOperation;
  elapsedSeconds: number;
  response?: ArchitectureResponse | undefined;
}) => {
  const steps = loadingSteps[operation];
  const activeIndex = steps.reduce((current, step, index) => {
    return elapsedSeconds >= step.threshold ? index : current;
  }, 0);
  const activeStep = steps[activeIndex] ?? {
    threshold: 0,
    label: "Working",
    detail: "Navix is preparing the next graph state."
  };
  const visibleSteps = steps.slice(0, 4);
  const visualStepIndex = Math.min(activeIndex, visibleSteps.length - 1);
  const progress = Math.round(((visualStepIndex + 1) / visibleSteps.length) * 100);
  const panelLabel = operation === "expand" ? "Expanding context" : "Connecting orbits";

  return (
    <section className={`loading-progress-panel ${elapsedSeconds >= 45 ? "is-long" : ""}`} aria-live="polite">
      <div className="loading-progress-header">
        <div className="loading-orbit-mark" aria-hidden="true">
          <span />
          <span />
          <i />
        </div>
        <div className="loading-progress-copy">
          <span>{panelLabel}</span>
          <strong>{activeStep.label}</strong>
        </div>
        <time>{elapsedSeconds}s</time>
      </div>
      <p className="loading-progress-detail">{activeStep.detail}</p>
      <div className="loading-progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol aria-label="Loading progress">
        {visibleSteps.map((step, index) => {
          const isComplete = index < visualStepIndex;
          const isActive = index === visualStepIndex;
          return (
            <li
              key={step.label}
              className={isComplete ? "complete" : isActive ? "active" : ""}
              aria-label={`${step.label}${isActive ? ", active" : isComplete ? ", complete" : ""}`}
            >
              <span aria-hidden="true">{isComplete ? "✓" : index + 1}</span>
              <b>{step.shortLabel}</b>
            </li>
          );
        })}
      </ol>
      {elapsedSeconds >= 45 ? (
        <div className="loading-help">
          <strong>Taking longer than usual?</strong>
          <span>
            Check token access, try a broader prompt, or keep the current {response ? "partial map" : "query"} running.
          </span>
        </div>
      ) : null}
    </section>
  );
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
