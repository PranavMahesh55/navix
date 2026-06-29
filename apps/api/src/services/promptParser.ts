import type { ArchitectureGenerateRequest, ArchitectureIntent, PromptIntent } from "@navix/shared";
import { config } from "../config/env.js";

const intentPatterns: Array<[ArchitectureIntent, RegExp]> = [
  ["impact_analysis", /\b(impact|safe to change|modify|blast radius|affected)\b/i],
  ["test_coverage_view", /\b(test|tests|coverage|spec)\b/i],
  ["dependency_map", /\b(dependency|dependencies|depends|imports|calls)\b/i],
  ["onboarding_path", /\b(onboard|learn|learning path|start|read first)\b/i],
  ["architecture_flow", /\b(flow|works|explain|architecture|trace|walkthrough)\b/i]
];

const featurePatterns: Array<[string, RegExp]> = [
  ["authentication", /\b(auth|authentic|authenticate|authentication|authorization|authorize|login|logout|session|token|password|credential|jwt|claim)\b/i],
  ["checkout", /\b(checkout|cart|payment|billing|order|purchase)\b/i],
  ["dependency graph", /\b(dependency|dependencies|impact|architecture|system)\b/i]
];

export class PromptParser {
  parse(request: ArchitectureGenerateRequest): PromptIntent {
    const prompt = request.prompt.trim();
    const depth = this.normalizeDepth(request.depth);

    return {
      rawPrompt: prompt,
      feature: this.detectFeature(prompt),
      intent: this.detectIntent(prompt),
      depth
    };
  }

  private detectFeature(prompt: string) {
    const match = featurePatterns.find(([, pattern]) => pattern.test(prompt));
    return match?.[0] ?? this.extractFallbackFeature(prompt);
  }

  private detectIntent(prompt: string): ArchitectureIntent {
    const match = intentPatterns.find(([, pattern]) => pattern.test(prompt));
    return match?.[0] ?? "architecture_flow";
  }

  private normalizeDepth(depth?: number) {
    if (!depth) {
      return config.defaultGraphDepth;
    }

    return Math.min(Math.max(Math.round(depth), 1), 4);
  }

  private extractFallbackFeature(prompt: string) {
    const normalized = prompt
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => {
        return ![
          "a",
          "an",
          "coverage",
          "explain",
          "for",
          "how",
          "spec",
          "test",
          "tests",
          "the",
          "view",
          "work",
          "works"
        ].includes(word);
      });

    return normalized.slice(0, 3).join(" ") || "architecture";
  }
}
