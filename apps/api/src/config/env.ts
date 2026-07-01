import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

const numberFromEnv = (key: string, fallback: number) => {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const orbitProviderFromEnv = () => {
  if (process.env.ORBIT_PROVIDER) {
    return process.env.ORBIT_PROVIDER;
  }

  if (process.env.NODE_ENV === "production" && process.env.ORBIT_API_URL && (process.env.ORBIT_API_KEY || process.env.GITLAB_TOKEN)) {
    return "orbit";
  }

  return "mock";
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 8080),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  gitlabBaseUrl: process.env.GITLAB_BASE_URL ?? "https://gitlab.com",
  gitlabToken: process.env.GITLAB_TOKEN,
  orbitProvider: orbitProviderFromEnv(),
  orbitApiUrl: process.env.ORBIT_API_URL,
  orbitApiKey: process.env.ORBIT_API_KEY,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  maxGraphNodes: numberFromEnv("MAX_GRAPH_NODES", 20),
  maxGraphEdges: numberFromEnv("MAX_GRAPH_EDGES", 30),
  defaultGraphDepth: numberFromEnv("DEFAULT_GRAPH_DEPTH", 2),
  enableCache: booleanFromEnv("ENABLE_CACHE", true),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
} as const;
