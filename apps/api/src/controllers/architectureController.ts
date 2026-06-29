import type { Request, Response } from "express";
import type { ArchitectureGenerateRequest, MermaidExportRequest, NodeDetails } from "@navix/shared";
import { z } from "zod";
import { GitLabSourceClient } from "../clients/gitlabSourceClient.js";
import { config } from "../config/env.js";
import { ExplanationService } from "../services/explanationService.js";
import { GraphBuilder } from "../services/graphBuilder.js";
import { OrbitService } from "../services/orbitService.js";
import { PromptParser } from "../services/promptParser.js";
import { SemanticNodeExplanationService } from "../services/semanticNodeExplanationService.js";
import { SourceSnippetService } from "../services/sourceSnippetService.js";
import { graphToMermaid } from "../utils/mermaid.js";

const generateSchema = z.object({
  prompt: z.string().trim().min(2),
  repoUrl: z.string().url().optional().or(z.literal("")),
  depth: z.number().int().min(1).max(4).optional()
});

const expandSchema = z.object({
  nodeId: z.string().min(1),
  prompt: z.string().optional(),
  repoUrl: z.string().url().optional().or(z.literal("")),
  depth: z.number().int().min(1).max(4).optional(),
  currentNodeIds: z.array(z.string()).optional()
});

const mermaidSchema = z.object({
  title: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      type: z.enum([
        "ui",
        "controller",
        "service",
        "model",
        "api",
        "database",
        "test",
        "config",
        "utility",
        "external"
      ]),
      filePath: z.string().optional(),
      summary: z.string().optional(),
      importanceScore: z.number(),
      dependencies: z.array(z.string()).optional(),
      relatedTests: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional()
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      label: z.string(),
      type: z.enum(["execution", "dependency", "data", "test", "ownership", "external"])
    })
  )
});

const nodeDetailsQuerySchema = z.object({
  repoUrl: z.string().url().optional()
});

const nodeDetailsBodySchema = z.object({
  repoUrl: z.string().url().optional(),
  details: z.custom<NodeDetails>().optional()
});

export class ArchitectureController {
  private readonly parser = new PromptParser();
  private readonly orbitService = new OrbitService();
  private readonly graphBuilder = new GraphBuilder();
  private readonly explanationService = new ExplanationService();
  private readonly sourceClient = new GitLabSourceClient({
    baseUrl: config.gitlabBaseUrl,
    token: config.gitlabToken
  });
  private readonly snippetService = new SourceSnippetService();
  private readonly semanticExplanationService = new SemanticNodeExplanationService();

  generate = async (req: Request, res: Response) => {
    const parsed = generateSchema.parse(req.body) as ArchitectureGenerateRequest;
    const prompt = this.parser.parse(parsed);
    const orbitResult = await this.orbitService.queryArchitecture(prompt, parsed.repoUrl || undefined);
    const graph = this.graphBuilder.build(orbitResult, prompt.depth);
    const response = this.explanationService.explain(
      prompt,
      orbitResult,
      graph.nodes,
      graph.edges
    );

    res.json(response);
  };

  expandNode = async (req: Request, res: Response) => {
    const parsed = expandSchema.parse(req.body);
    const prompt = this.parser.parse({
      prompt: parsed.prompt || `Expand ${parsed.nodeId}`,
      repoUrl: parsed.repoUrl || undefined,
      depth: parsed.depth
    });

    const orbitResult = await this.orbitService.expandNode(
      parsed.nodeId,
      prompt,
      parsed.repoUrl || undefined,
      parsed.currentNodeIds
    );
    const graph = this.graphBuilder.build(orbitResult, prompt.depth);
    const nodeDetails = this.explanationService.buildNodeDetails(graph.nodes, graph.edges);
    const learningPath = this.explanationService.buildLearningPath(graph.nodes, graph.edges);

    res.json({
      nodes: graph.nodes,
      edges: graph.edges,
      nodeDetails,
      learningPath,
      grounding: {
        provider: orbitResult.provider,
        repoUrl: orbitResult.repoUrl,
        symbolCount: orbitResult.symbols.length,
        generatedAt: new Date().toISOString(),
        limitations: orbitResult.limitations
      }
    });
  };

  nodeDetails = async (req: Request, res: Response) => {
    const nodeId = req.params.nodeId;
    if (!nodeId) {
      res.status(400).json({ error: "nodeId is required" });
      return;
    }

    const query = nodeDetailsQuerySchema.parse(req.query);
    const body = nodeDetailsBodySchema.parse(req.body ?? {});
    const details = body.details ?? await this.orbitService.getNodeDetails(nodeId);
    if (!details) {
      res.status(404).json({ error: `Node ${nodeId} was not found in Orbit results.` });
      return;
    }

    const repoUrl = body.repoUrl ?? query.repoUrl;
    if (!repoUrl) {
      throw new Error("Source-grounded node details failed: repoUrl query parameter is required.");
    }

    if (!details.filePath) {
      throw new Error(`Source-grounded node details failed: node ${details.label} does not have a file path.`);
    }

    try {
      const source = await this.sourceClient.getRawFile(repoUrl, details.filePath);
      const snippet = this.snippetService.buildSnippet(source, details);
      const semanticDetails = await this.semanticExplanationService.explain({
        details,
        repoUrl,
        sourceSnippet: snippet.text,
        snippetLineCount: snippet.lineCount
      });

      res.json(semanticDetails);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Source summary unavailable.";
      res.json({
        ...details,
        evidence: details.evidence
          ? {
              ...details.evidence,
              missing: [...new Set([...details.evidence.missing, message])]
            }
          : details.evidence
      });
    }
  };

  exportMermaid = (req: Request, res: Response) => {
    const parsed = mermaidSchema.parse(req.body) as MermaidExportRequest;
    res.json({
      mermaid: graphToMermaid(parsed.nodes, parsed.edges, parsed.title)
    });
  };
}
