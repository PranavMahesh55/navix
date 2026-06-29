import type {
  NodeDetails,
  OrbitQueryResult,
  PromptIntent
} from "@navix/shared";

export type OrbitClient = {
  queryArchitecture(input: PromptIntent, repoUrl?: string): Promise<OrbitQueryResult>;
  expandNode(
    nodeId: string,
    input: PromptIntent,
    repoUrl?: string,
    currentNodeIds?: string[]
  ): Promise<OrbitQueryResult>;
  getNodeDetails(nodeId: string): Promise<NodeDetails | undefined>;
};
