import type { LearningPathStep } from "@navix/shared";

type LearningPathProps = {
  steps: LearningPathStep[];
  selectedNodeId?: string | undefined;
  onSelect: (nodeId: string) => void;
};

export const LearningPath = ({ steps, selectedNodeId, onSelect }: LearningPathProps) => {
  return (
    <div className="learning-path">
      <div className="panel-heading">
        <span>Learning Path</span>
        <strong>{steps.length}</strong>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.nodeId}>
            <button
              type="button"
              className={selectedNodeId === step.nodeId ? "active" : ""}
              onClick={() => onSelect(step.nodeId)}
            >
              <span>{step.order}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.reason}</small>
              </div>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};
