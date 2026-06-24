import { Download, Eye, EyeOff, Focus, GitFork, Maximize2 } from "lucide-react";

type GraphToolbarProps = {
  showTests: boolean;
  hasSelection: boolean;
  onResetView: () => void;
  onToggleTests: () => void;
  onExpandSelected: () => void;
  onExportMermaid: () => void;
};

export const GraphToolbar = ({
  showTests,
  hasSelection,
  onResetView,
  onToggleTests,
  onExpandSelected,
  onExportMermaid
}: GraphToolbarProps) => {
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
        title="Expand selected node"
        aria-label="Expand selected node"
        disabled={!hasSelection}
        onClick={onExpandSelected}
      >
        <GitFork size={18} />
      </button>
      <button type="button" title="Export Mermaid" aria-label="Export Mermaid" onClick={onExportMermaid}>
        <Download size={18} />
      </button>
      <button type="button" title="Fit graph" aria-label="Fit graph" onClick={onResetView}>
        <Maximize2 size={18} />
      </button>
    </div>
  );
};
