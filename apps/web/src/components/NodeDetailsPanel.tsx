import {
  Code2,
  Compass,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  ListChecks,
  ShieldCheck,
  X
} from "lucide-react";
import type { ArchitectureResponse, GraphNode, NodeDetails } from "@navix/shared";
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
    <h2>Select a node</h2>
    <p>Purpose, files, dependencies, and tests will appear here.</p>
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
              <strong>Summarizing source</strong>
            </div>
          </div>
        ) : sourceDetailsFailed ? (
          <div className="source-grounding-loading failed" role="status" aria-live="polite">
            <div>
              <strong>Source summary failed</strong>
            </div>
          </div>
        ) : (
          <div className="source-grounding-loading" role="status" aria-live="polite">
            <span />
            <div>
              <strong>Source summary pending</strong>
            </div>
          </div>
        )}
        {selectedDetails.sourceGrounding ? (
          <p className="source-grounding-note">
            Source: {compactPath(selectedDetails.sourceGrounding.filePath)}
          </p>
        ) : null}
      </section>

      <EvidencePanel details={selectedDetails} />

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
        <FileRows files={relatedFiles} repoUrl={response.grounding.repoUrl} />
      </section>

      <section>
        <h3>
          <ListChecks size={16} />
          Related Tests ({relatedTests.length})
        </h3>
        <FileRows files={relatedTests} repoUrl={response.grounding.repoUrl} />
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

const EvidencePanel = ({ details }: { details: NodeDetails }) => {
  const evidence = details.evidence;
  const confidence = evidence?.confidence ?? (details.sourceGrounding ? "medium" : "low");
  const missing = evidence?.missing ?? [];
  const relationshipEvidence = details.relationshipEvidence ?? [];

  return (
    <section>
      <h3>
        <ShieldCheck size={16} />
        Evidence
      </h3>
      <div className="evidence-grid">
        <div>
          <span>Confidence</span>
          <strong className={`confidence-${confidence}`}>{confidence}</strong>
        </div>
        <div>
          <span>Definitions</span>
          <strong>{evidence?.indexedDefinitionCount ?? details.indexedDefinitions?.length ?? 0}</strong>
        </div>
        <div>
          <span>Incoming</span>
          <strong>{evidence?.incomingCount ?? details.dependents.length}</strong>
        </div>
        <div>
          <span>Outgoing</span>
          <strong>{evidence?.outgoingCount ?? details.dependencies.length}</strong>
        </div>
      </div>
      {relationshipEvidence.length > 0 ? (
        <ul className="evidence-list">
          {relationshipEvidence.slice(0, 2).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {missing.length > 0 ? (
        <div className="missing-evidence">
          <strong>Missing signals</strong>
          <ul>
            {missing.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

const FileRows = ({
  files,
  repoUrl
}: {
  files: Array<{ name: string; meta: string; path?: string | undefined; signal?: string | undefined }>;
  repoUrl?: string | undefined;
}) => {
  if (files.length === 0) {
    return <p className="muted-text">No grounded files or tests were returned for this section.</p>;
  }

  return (
    <div className="file-row-list">
      {files.map((file) => (
        <div key={`${file.name}-${file.meta}`}>
          <span className="file-row-main">
            <span>
              <FileText size={14} />
              {file.name}
            </span>
            <small>{file.signal ?? file.meta}</small>
          </span>
          {repoUrl && file.path ? (
            <a href={gitlabFileUrl(repoUrl, file.path)} target="_blank" rel="noreferrer" title="Open in GitLab">
              <ExternalLink size={14} />
            </a>
          ) : null}
          {file.path ? (
            <button
              type="button"
              title="Copy file path"
              aria-label={`Copy path for ${file.name}`}
              onClick={() => {
                void navigator.clipboard?.writeText(file.path ?? "");
              }}
            >
              <Clipboard size={14} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
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
    meta: compactPath(file),
    path: file
  }));
};

const buildRelatedTests = (details: NodeDetails) => {
  const tests = details.relatedTests.map((node) => node.filePath ?? `${node.label}.spec.ts`);

  return tests.slice(0, 3).map((file) => ({
    name: basename(file),
    meta: compactPath(file),
    path: file
  }));
};

const basename = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

const compactPath = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : path;
};

const gitlabFileUrl = (repoUrl: string, path: string) => {
  return `${repoUrl.replace(/\/+$/, "")}/-/blob/main/${path.replace(/^\/+/, "")}`;
};
