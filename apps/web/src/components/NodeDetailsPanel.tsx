import {
  BookOpen,
  Code2,
  Compass,
  Database,
  FileText,
  HelpCircle,
  ListChecks,
  Route,
  ShieldCheck,
  X
} from "lucide-react";
import type { ArchitectureResponse, GraphNode, NodeDetails } from "@orbit-atlas/shared";
import { roleStyles } from "../graph/roleStyles";

type NodeDetailsPanelProps = {
  response?: ArchitectureResponse | undefined;
  selectedDetails?: NodeDetails | undefined;
  isGeneratingSourceDetails?: boolean | undefined;
  sourceDetailsFailed?: boolean | undefined;
  mermaid?: string | undefined;
  onClose?: (() => void) | undefined;
};

const EmptyState = () => (
  <div className="empty-panel">
    <ShieldCheck size={26} />
    <h2>Orbit Grounding</h2>
    <p>Every node and explanation is derived from Orbit-indexed relationships.</p>
  </div>
);

export const NodeDetailsPanel = ({
  response,
  selectedDetails,
  isGeneratingSourceDetails = false,
  sourceDetailsFailed = false,
  mermaid,
  onClose
}: NodeDetailsPanelProps) => {
  if (!response) {
    return <EmptyState />;
  }

  if (!selectedDetails) {
    return (
      <div className="details-stack">
        <PanelHeader onClose={onClose} />
        <section>
          <h2>Overview</h2>
          <p>{response.overview}</p>
        </section>
        <section>
          <h3>Grounding</h3>
          <div className="metric-list">
            <span>Provider</span>
            <strong>{response.grounding.provider}</strong>
            <span>Symbols</span>
            <strong>{response.grounding.symbolCount}</strong>
            <span>Nodes</span>
            <strong>{response.nodes.length}</strong>
            <span>Edges</span>
            <strong>{response.edges.length}</strong>
          </div>
        </section>
      </div>
    );
  }

  const style = roleStyles[selectedDetails.type];
  const relatedFiles = buildRelatedFiles(selectedDetails);
  const relatedTests = buildRelatedTests(selectedDetails);

  return (
    <div className="details-stack">
      <PanelHeader onClose={onClose} />

      <section className="selected-node-hero">
        <div className="selected-node-title">
          <span className="selected-node-icon" style={{ color: style.accent, background: style.soft }}>
            <Code2 size={18} />
          </span>
          <div>
            <h2>{selectedDetails.label}</h2>
            <div className="node-meta">
              <span style={{ color: style.accent, background: style.soft }}>{style.label}</span>
              <small>{selectedDetails.filePath ? compactPath(selectedDetails.filePath) : "Node.js"}</small>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3>
          <Compass size={16} />
          Purpose
        </h3>
        {selectedDetails.sourceGrounding ? (
          <p>{selectedDetails.purpose}</p>
        ) : isGeneratingSourceDetails ? (
          <div className="source-grounding-loading" role="status" aria-live="polite">
            <span />
            <div>
              <strong>LLM summarization in progress</strong>
              <p>Fetching GitLab source and generating a source-grounded purpose for this node.</p>
            </div>
          </div>
        ) : sourceDetailsFailed ? (
          <div className="source-grounding-loading failed" role="status" aria-live="polite">
            <div>
              <strong>Source-grounded purpose failed</strong>
              <p>Check the API error message, then retry by regenerating the map or selecting another node.</p>
            </div>
          </div>
        ) : (
          <div className="source-grounding-loading" role="status" aria-live="polite">
            <span />
            <div>
              <strong>Waiting for LLM summarization</strong>
              <p>The source-grounded purpose will appear here when generation starts.</p>
            </div>
          </div>
        )}
        {selectedDetails.sourceGrounding ? (
          <p className="source-grounding-note">
            Source-grounded with {selectedDetails.sourceGrounding.model} from {selectedDetails.sourceGrounding.snippetLineCount} lines in{" "}
            {compactPath(selectedDetails.sourceGrounding.filePath)}.
          </p>
        ) : null}
      </section>

      <section>
        <h3>
          <Database size={16} />
          Dependencies ({selectedDetails.dependencies.length})
        </h3>
        <DependencyStrip dependencies={selectedDetails.dependencies} />
      </section>

      <section>
        <h3>
          <FileText size={16} />
          Related Files ({relatedFiles.length})
        </h3>
        <FileRows files={relatedFiles} />
      </section>

      <section>
        <h3>
          <ListChecks size={16} />
          Related Tests ({relatedTests.length})
        </h3>
        <FileRows files={relatedTests} />
      </section>

      {selectedDetails.indexedDefinitions && selectedDetails.indexedDefinitions.length > 0 ? (
        <section>
          <h3>
            <BookOpen size={16} />
            Indexed Definitions
          </h3>
          <CompactList items={selectedDetails.indexedDefinitions} empty="No indexed definitions in graph" />
        </section>
      ) : null}

      <section>
        <h3>
          <Route size={16} />
          Onboarding Notes
        </h3>
        <GuidanceList items={selectedDetails.onboardingNotes ?? []} empty="No onboarding notes for this node" />
      </section>

      <section>
        <h3>
          <HelpCircle size={16} />
          Questions Before Editing
        </h3>
        <GuidanceList items={selectedDetails.inspectionQuestions ?? []} empty="No inspection questions for this node" />
      </section>

      {mermaid ? (
        <section>
          <h3>Mermaid</h3>
          <pre className="mermaid-output">{mermaid}</pre>
        </section>
      ) : null}
    </div>
  );
};

const PanelHeader = ({ onClose }: { onClose?: (() => void) | undefined }) => (
  <div className="selected-panel-header">
    <span>Selected Node</span>
    <button type="button" aria-label="Close selected node panel" onClick={onClose}>
      <X size={16} />
    </button>
  </div>
);

const DependencyStrip = ({ dependencies }: { dependencies: GraphNode[] }) => {
  const visible = dependencies.slice(0, 5);
  const remaining = dependencies.length - visible.length;

  if (dependencies.length === 0) {
    return <p className="muted-text">No outgoing dependencies in the current graph depth.</p>;
  }

  return (
    <div className="dependency-strip">
      {visible.map((node) => {
        const style = roleStyles[node.type];
        return (
          <span key={node.id} title={node.label} style={{ color: style.accent, background: style.soft }}>
            {node.label.slice(0, 2).toUpperCase()}
          </span>
        );
      })}
      {remaining > 0 ? <strong>+{remaining}</strong> : null}
    </div>
  );
};

const FileRows = ({ files }: { files: Array<{ name: string; meta: string; signal?: string | undefined }> }) => {
  if (files.length === 0) {
    return <p className="muted-text">No grounded files or tests were returned for this section.</p>;
  }

  return (
    <div className="file-row-list">
      {files.map((file) => (
        <div key={`${file.name}-${file.meta}`}>
          <span>
            <FileText size={14} />
            {file.name}
          </span>
          <small>{file.signal ?? file.meta}</small>
        </div>
      ))}
    </div>
  );
};

const CompactList = ({ items, empty }: { items: string[]; empty: string }) => {
  const uniqueItems = [...new Set(items)];

  if (uniqueItems.length === 0) {
    return <p className="muted-text">{empty}</p>;
  }

  return (
    <ul className="compact-list">
      {uniqueItems.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

const GuidanceList = ({ items, empty }: { items: string[]; empty: string }) => {
  const uniqueItems = [...new Set(items)];

  if (uniqueItems.length === 0) {
    return <p className="muted-text">{empty}</p>;
  }

  return (
    <ul className="guidance-list">
      {uniqueItems.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

const buildRelatedFiles = (details: NodeDetails) => {
  const files = [
    details.filePath ?? `${details.label}.ts`,
    ...details.dependencies.map((node) => node.filePath).filter((value): value is string => Boolean(value)),
    ...details.dependents.map((node) => node.filePath).filter((value): value is string => Boolean(value))
  ];

  const unique = [...new Set(files)].slice(0, 3);
  return unique.map((file) => ({
    name: basename(file),
    meta: compactPath(file)
  }));
};

const buildRelatedTests = (details: NodeDetails) => {
  const tests = details.relatedTests.map((node) => node.filePath ?? `${node.label}.spec.ts`);

  return tests.slice(0, 3).map((file) => ({
    name: basename(file),
    meta: compactPath(file)
  }));
};

const basename = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

const compactPath = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : path;
};
