import { Download, Eye, EyeOff, Focus, GitFork, Maximize2 } from "lucide-react";

type GraphToolbarProps = {
  showTests: boolean;
  hasSelection: boolean;
  loading: boolean;
  expanded: boolean;
  onResetView: () => void;
  onToggleTests: () => void;
  onExpandSelected: () => void;
  onExportMermaid: () => void;
  onToggleExpanded: () => void;
};

export const GraphToolbar = ({
  showTests,
  hasSelection,
  loading,
  expanded,
  onResetView,
  onToggleTests,
  onExpandSelected,
  onExportMermaid,
  onToggleExpanded
}: GraphToolbarProps) => {
  const expandingSelection = loading && hasSelection;

  return (
    <div className="graph-toolbar" aria-label="Graph tools">
      <button type="button" title="Reset view" aria-label="Reset view" onClick={onResetView}>
        <Focus size={18} />
      </button>
      <button
        type="button"
        title={showTests ? "Hide tests" : "Show tests"}
        aria-label={showTests ? "Hide tests" : "Show tests"}
        className={showTests ? "active" : ""}
        onClick={onToggleTests}
      >
        {showTests ? <Eye size={18} /> : <EyeOff size={18} />}
      </button>
      <button
        type="button"
        title={expandingSelection ? "Expanding selected node" : "Expand selected node"}
        aria-label={expandingSelection ? "Expanding selected node" : "Expand selected node"}
        className={expandingSelection ? "active" : ""}
        disabled={!hasSelection || loading}
        onClick={onExpandSelected}
      >
        <GitFork size={18} />
      </button>
      <button type="button" title="Export Mermaid" aria-label="Export Mermaid" onClick={onExportMermaid}>
        <Download size={18} />
      </button>
      <button
        type="button"
        title={expanded ? "Restore map layout" : "Expand map"}
        aria-label={expanded ? "Restore map layout" : "Expand map"}
        className={expanded ? "active" : ""}
        onClick={onToggleExpanded}
      >
        <Maximize2 size={18} />
      </button>
    </div>
  );
};
