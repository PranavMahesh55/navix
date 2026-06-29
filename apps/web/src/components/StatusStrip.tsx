import type { ArchitectureResponse } from "@navix/shared";

type StatusStripProps = {
  response?: ArchitectureResponse | undefined;
  loading: boolean;
  operation?: "generate" | "expand" | undefined;
  elapsedSeconds?: number | undefined;
  error?: string | undefined;
  notice?: string | undefined;
};

export const StatusStrip = ({ response, loading, operation = "generate", elapsedSeconds = 0, error, notice }: StatusStripProps) => {
  const loadingLabel = operation === "expand" ? "Expanding map" : "Querying Orbit";

  return (
    <div className="status-strip">
      <span className={loading ? "status-dot loading" : error ? "status-dot error" : "status-dot"} />
      <span>{loading ? `${loadingLabel} · ${elapsedSeconds}s` : error ? error : notice ? notice : response ? response.prompt.feature : "Ready"}</span>
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
