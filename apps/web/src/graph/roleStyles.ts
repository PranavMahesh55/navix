import type { ArchitectureNodeType } from "@navix/shared";

type RoleStyle = {
  label: string;
  accent: string;
  soft: string;
};

export const roleStyles: Record<ArchitectureNodeType, RoleStyle> = {
  ui: { label: "UI", accent: "#0f766e", soft: "#ccfbf1" },
  api: { label: "API", accent: "#2563eb", soft: "#dbeafe" },
  controller: { label: "Controller", accent: "#be123c", soft: "#ffe4e6" },
  service: { label: "Service", accent: "#7c3aed", soft: "#ede9fe" },
  model: { label: "Model", accent: "#a16207", soft: "#fef3c7" },
  database: { label: "Database", accent: "#15803d", soft: "#dcfce7" },
  test: { label: "Test", accent: "#6d28d9", soft: "#f3e8ff" },
  config: { label: "Config", accent: "#475569", soft: "#e2e8f0" },
  utility: { label: "Utility", accent: "#0891b2", soft: "#cffafe" },
  external: { label: "External", accent: "#c2410c", soft: "#ffedd5" }
};
