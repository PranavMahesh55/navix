import type { NodeDetails } from "@navix/shared";
import { config } from "../config/env.js";

type SemanticExplanationInput = {
  details: NodeDetails;
  repoUrl: string;
  sourceSnippet: string;
  snippetLineCount: number;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type SemanticPayload = {
  summary: string;
  purpose: string;
  onboardingNotes: string[];
  inspectionQuestions: string[];
};

export class SemanticNodeExplanationService {
  async explain(input: SemanticExplanationInput): Promise<NodeDetails> {
    if (!config.openAiApiKey) {
      throw new Error("OpenAI semantic explanation failed: OPENAI_API_KEY is not configured.");
    }

    const payload = await this.callOpenAi(input);

    return {
      ...input.details,
      summary: payload.summary,
      purpose: payload.purpose,
      onboardingNotes: payload.onboardingNotes,
      inspectionQuestions: payload.inspectionQuestions,
      evidence: input.details.evidence
        ? {
            ...input.details.evidence,
            sourceFile: input.details.filePath ?? input.details.evidence.sourceFile,
            snippetLineCount: input.snippetLineCount,
            confidence: input.details.relationshipEvidence && input.details.relationshipEvidence.length > 0 ? "high" : input.details.evidence.confidence
          }
        : {
            sourceFile: input.details.filePath,
            snippetLineCount: input.snippetLineCount,
            indexedDefinitionCount: input.details.indexedDefinitions?.length ?? 0,
            incomingCount: input.details.dependents.length,
            outgoingCount: input.details.dependencies.length,
            relatedTestCount: input.details.relatedTests.length,
            confidence: "medium",
            missing: input.details.relatedTests.length > 0 ? [] : ["No related tests appeared at this graph depth."]
          },
      sourceGrounding: {
        status: "openai",
        model: config.openAiModel,
        repoUrl: input.repoUrl,
        filePath: input.details.filePath ?? "",
        snippetLineCount: input.snippetLineCount,
        generatedAt: new Date().toISOString()
      }
    };
  }

  private async callOpenAi(input: SemanticExplanationInput): Promise<SemanticPayload> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openAiModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You explain codebase architecture for developer onboarding.",
              "Use only the provided Orbit metadata and source snippet.",
              "Do not invent runtime behavior, dependencies, APIs, or business rules.",
              "If evidence is incomplete, say what the code appears to do and name the uncertainty.",
              "Return strict JSON with keys: summary, purpose, onboardingNotes, inspectionQuestions.",
              "summary must be one concise sentence.",
              "purpose must be a detailed high-level explanation of the node itself, how it fits into the current architecture map, and what changing it could affect.",
              "onboardingNotes must be 3-5 concrete notes.",
              "inspectionQuestions must be 3-5 questions a developer should answer before editing."
            ].join(" ")
          },
          {
            role: "user",
            content: this.buildPrompt(input)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI semantic explanation failed: ${response.status} ${await safeResponseText(response)}`);
    }

    const body = (await response.json()) as OpenAiChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI semantic explanation failed: response did not include message content.");
    }

    return parseSemanticPayload(content);
  }

  private buildPrompt(input: SemanticExplanationInput) {
    const details = input.details;
    const dependencies = details.dependencies.map(formatNode).join("\n") || "None in current graph.";
    const dependents = details.dependents.map(formatNode).join("\n") || "None in current graph.";
    const relatedTests = details.relatedTests.map(formatNode).join("\n") || "None in current graph.";
    const definitions = details.indexedDefinitions?.join(", ") || "None returned by Orbit.";

    return [
      `Repository: ${input.repoUrl}`,
      `Node: ${details.label}`,
      `Role: ${details.type}`,
      `File: ${details.filePath ?? "unknown"}`,
      `Indexed definitions: ${definitions}`,
      "",
      "Incoming dependents from Orbit:",
      dependents,
      "",
      "Outgoing dependencies from Orbit:",
      dependencies,
      "",
      "Related tests from Orbit:",
      relatedTests,
      "",
      "Source snippet with line numbers:",
      "```",
      input.sourceSnippet,
      "```"
    ].join("\n");
  }
}

const formatNode = (node: { label: string; type: string; filePath?: string | undefined }) => {
  return `- ${node.label} (${node.type})${node.filePath ? ` at ${node.filePath}` : ""}`;
};

const parseSemanticPayload = (content: string): SemanticPayload => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`OpenAI semantic explanation failed: response was not valid JSON. ${error instanceof Error ? error.message : ""}`.trim());
  }

  if (!isRecord(parsed)) {
    throw new Error("OpenAI semantic explanation failed: JSON payload was not an object.");
  }

  const summary = stringValue(parsed.summary, "summary");
  const purpose = stringValue(parsed.purpose, "purpose");
  const onboardingNotes = stringArrayValue(parsed.onboardingNotes, "onboardingNotes");
  const inspectionQuestions = stringArrayValue(parsed.inspectionQuestions, "inspectionQuestions");

  return {
    summary,
    purpose,
    onboardingNotes,
    inspectionQuestions
  };
};

const stringValue = (value: unknown, key: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OpenAI semantic explanation failed: JSON key "${key}" must be a non-empty string.`);
  }
  return value.trim();
};

const stringArrayValue = (value: unknown, key: string) => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`OpenAI semantic explanation failed: JSON key "${key}" must be a non-empty string array.`);
  }
  return value.map((item) => item.trim()).slice(0, 5);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const safeResponseText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  return text.slice(0, 800) || response.statusText;
};
