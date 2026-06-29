import { memo, useEffect } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps
} from "@xyflow/react";
import type { GraphEdge, GraphNode } from "@navix/shared";
import { buildFlowElements } from "../graph/layout";
import { roleStyles } from "../graph/roleStyles";
import type { AtlasNodeData } from "../types/graph";

type ArchitectureGraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  showTests: boolean;
  selectedNodeId?: string | undefined;
  selectedEdgeId?: string | undefined;
  resetSignal: number;
  onSelectNode: (node: GraphNode) => void;
  onSelectEdge?: ((edge: GraphEdge) => void) | undefined;
};

const AtlasNode = memo(({ data, selected }: NodeProps<Node<AtlasNodeData>>) => {
  const node = data.atlasNode;
  const style = roleStyles[node.type];

  return (
    <div className={`atlas-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="atlas-node-header">
        <span className="role-dot" style={{ background: style.accent }} />
        <span style={{ color: style.accent }}>{style.label}</span>
      </div>
      <div className="atlas-node-label">{node.label}</div>
      {node.filePath ? <div className="atlas-node-path">{node.filePath}</div> : null}
      <div className="atlas-node-score" style={{ background: style.soft, color: style.accent }}>
        {node.importanceScore}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

AtlasNode.displayName = "AtlasNode";

const nodeTypes = {
  atlas: AtlasNode
};

const GraphCanvas = ({
  nodes,
  edges,
  showTests,
  selectedNodeId,
  selectedEdgeId,
  resetSignal,
  onSelectNode,
  onSelectEdge
}: ArchitectureGraphProps) => {
  const { flowNodes, flowEdges } = buildFlowElements(nodes, edges, showTests, selectedNodeId, selectedEdgeId);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitView({ padding: 0.08, duration: 240 }));
    const timeout = window.setTimeout(() => fitView({ padding: 0.08, duration: 240 }), 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [fitView, resetSignal, nodes.length, edges.length, showTests]);

  const selectedAwareNodes = flowNodes.map((node) => ({
    ...node,
    selected: node.id === selectedNodeId
  }));

  return (
    <ReactFlow
      nodes={selectedAwareNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      minZoom={0.42}
      maxZoom={1.5}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => onSelectNode(node.data.atlasNode)}
      onEdgeClick={(_event, edge) => {
        const graphEdge = edges.find((candidate) => candidate.id === edge.id);
        if (graphEdge) {
          onSelectEdge?.(graphEdge);
        }
      }}
    >
      <Background color="#d6dde1" gap={24} />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        nodeColor={(node) => {
          const atlasNode = (node.data as AtlasNodeData).atlasNode;
          return roleStyles[atlasNode.type].accent;
        }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
};

export const ArchitectureGraph = (props: ArchitectureGraphProps) => {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
};
