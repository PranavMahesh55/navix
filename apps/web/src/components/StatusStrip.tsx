import type { ArchitectureResponse } from "@orbit-atlas/shared";

type StatusStripProps = {
  response?: ArchitectureResponse | undefined;
  loading: boolean;
  error?: string | undefined;
  notice?: string | undefined;
};

export const StatusStrip = ({ response, loading, error, notice }: StatusStripProps) => {
  return (
    <div className="status-strip">
      <span className={loading ? "status-dot loading" : error ? "status-dot error" : "status-dot"} />
      <span>{loading ? "Querying Orbit" : error ? error : notice ? notice : response ? response.prompt.feature : "Ready"}</span>
      {response ? (
        <>
          <strong>{response.nodes.length} nodes</strong>
          <strong>{response.edges.length} edges</strong>
          <strong>{response.grounding.provider}</strong>
        </>
      ) : null}
    </div>
  );
};
