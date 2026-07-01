import type {
  ArchitectureNodeType,
  GraphEdge,
  GraphNode,
  NodeDetails,
  OrbitDependency,
  OrbitQueryResult,
  OrbitSymbol,
  PromptIntent
} from "@navix/shared";
import type { OrbitClient } from "../types/orbitClient.js";

type RealOrbitClientOptions = {
  apiUrl?: string | undefined;
  apiKey?: string | undefined;
  gitlabBaseUrl?: string | undefined;
  gitlabToken?: string | undefined;
};

type OrbitQueryEnvelope = {
  result?: unknown;
  row_count?: number;
  query_type?: string;
  raw_query_strings?: string[] | null;
};

type OrbitEntity = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
};

type OrbitDefinition = {
  id: string;
  name: string;
  fqn?: string | undefined;
  definitionType?: string | undefined;
  filePath?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
};

type OrbitFile = {
  id: string;
  path: string;
  name?: string | undefined;
  language?: string | undefined;
  extension?: string | undefined;
};

type OrbitImport = {
  id: string;
  filePath?: string | undefined;
  importPath?: string | undefined;
  importType?: string | undefined;
  identifierName?: string | undefined;
  identifierAlias?: string | undefined;
};

type ComponentRecord = GraphNode & {
  summary: string;
  definitionIds: string[];
  definitionNames: string[];
};

type DepthSettings = {
  depth: number;
  testFocused: boolean;
  definitionSearches: Array<"name" | "file_path" | "fqn">;
  definitionLimit: number;
  fileLimit: number;
  importLimit: number;
  componentLimit: number;
  callSourceLimit: number;
  callLimit: number;
  includeImports: boolean;
  includeCalls: boolean;
};

const definitionColumns = [
  "id",
  "file_path",
  "fqn",
  "name",
  "definition_type",
  "start_line",
  "end_line"
];

const fileColumns = ["id", "path", "name", "extension", "language"];

const importColumns = [
  "id",
  "file_path",
  "import_type",
  "import_path",
  "identifier_name",
  "identifier_alias"
];

const orbitRequestTimeoutMs = 30_000;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "architecture",
  "explain",
  "flow",
  "for",
  "how",
  "in",
  "is",
  "map",
  "of",
  "the",
  "to",
  "view",
  "what",
  "where",
  "work",
  "works"
]);

const roleWeights: Record<ArchitectureNodeType, number> = {
  service: 95,
  controller: 90,
  api: 82,
  ui: 78,
  model: 74,
  database: 66,
  external: 60,
  utility: 56,
  config: 50,
  test: 42
};

export class RealOrbitClient implements OrbitClient {
  private readonly apiUrl?: string | undefined;
  private readonly apiKey?: string | undefined;
  private readonly gitlabBaseUrl: string;
  private readonly gitlabToken?: string | undefined;
  private readonly detailsCache = new Map<string, NodeDetails>();
  private readonly lastComponents = new Map<string, ComponentRecord>();

  constructor(options: RealOrbitClientOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.gitlabBaseUrl = (options.gitlabBaseUrl ?? "https://gitlab.com").replace(/\/+$/, "");
    this.gitlabToken = options.gitlabToken;
  }

  async queryArchitecture(input: PromptIntent, repoUrl?: string): Promise<OrbitQueryResult> {
    this.assertConfigured();

    const projectPath = parseProjectPath(repoUrl);
    const tokens = buildSearchTokens(input);
    const depthSettings = settingsForDepth(input.depth, input.intent);
    const limitations = [
      "Orbit results are scoped to repositories the configured GitLab token can access.",
      "Orbit Remote indexes the default branch and may lag recent pushes until re-indexing completes."
    ];
    if (projectPath && !(await this.canAccessProject(projectPath, limitations))) {
      return {
        provider: "gitlab-orbit",
        repoUrl,
        feature: input.feature,
        intent: input.intent,
        symbols: [],
        dependencies: [],
        limitations
      };
    }

    const definitions = await this.findRelevantDefinitions(tokens, projectPath, limitations, depthSettings);
    let files = definitions.length < 4 || depthSettings.depth >= 2
      ? await this.findRelevantFiles(tokens, projectPath, limitations, depthSettings)
      : [];

    if (files.length === 0 && projectPath) {
      files = await this.findRelevantGitLabFiles(tokens, projectPath, limitations, depthSettings);
    }

    const components = this.buildComponents(definitions, files, tokens, depthSettings);
    const imports = components.length > 0 && depthSettings.includeImports
      ? await this.findRelevantImports(tokens, projectPath, limitations, depthSettings)
      : [];
    const dependencies = await this.buildDependencies(components, imports, limitations, depthSettings);

    this.refreshDetailsCache(components, dependencies);

    return {
      provider: "gitlab-orbit",
      repoUrl,
      feature: input.feature,
      intent: input.intent,
      symbols: components.map(stripComponentMetadata),
      dependencies,
      limitations
    };
  }

  async expandNode(
    nodeId: string,
    input: PromptIntent,
    repoUrl?: string,
    currentNodeIds: string[] = []
  ): Promise<OrbitQueryResult> {
    this.assertConfigured();

    const current = this.lastComponents.get(nodeId);
    const nextInput = current
      ? {
          ...input,
          rawPrompt: `${input.rawPrompt} ${current.label} ${current.filePath ?? ""}`,
          feature: `${input.feature} ${current.label}`
        }
      : input;

    const result = await this.queryArchitecture(nextInput, repoUrl);
    const currentIds = new Set(currentNodeIds);

    if (currentIds.size === 0) {
      return result;
    }

    const selectedIds = new Set<string>([nodeId]);
    for (const edge of result.dependencies) {
      if (edge.source === nodeId) {
        selectedIds.add(edge.target);
      }
      if (edge.target === nodeId) {
        selectedIds.add(edge.source);
      }
    }

    const expandedSymbols = result.symbols.filter((symbol) => {
      return selectedIds.has(symbol.id) || !currentIds.has(symbol.id);
    });
    const expandedIds = new Set(expandedSymbols.map((symbol) => symbol.id));
    const expandedDependencies = result.dependencies.filter((edge) => {
      return expandedIds.has(edge.source) && expandedIds.has(edge.target);
    });

    return {
      ...result,
      symbols: expandedSymbols,
      dependencies: expandedDependencies
    };
  }

  async getNodeDetails(nodeId: string): Promise<NodeDetails | undefined> {
    this.assertConfigured();
    return this.detailsCache.get(nodeId);
  }

  private async findRelevantDefinitions(
    tokens: string[],
    projectPath: string | undefined,
    limitations: string[],
    settings: DepthSettings
  ) {
    const definitions = new Map<string, OrbitDefinition>();

    for (const property of settings.definitionSearches) {
      const rows = await this.safeQuery(
        () => this.queryDefinitions(property, tokens, projectPath, settings.definitionLimit),
        `Definition.${property}`,
        limitations
      );

      for (const definition of rows) {
        definitions.set(definition.id, definition);
      }
    }

    return [...definitions.values()];
  }

  private async canAccessProject(projectPath: string, limitations: string[]) {
    const rows = await this.safeQuery(
      () => this.queryProject(projectPath),
      "Project.full_path",
      limitations
    );

    if (rows.length === 0) {
      limitations.push(`Orbit did not return project ${projectPath}; it may be inaccessible, not indexed, or outside the token scope.`);
      return false;
    }

    return true;
  }

  private async findRelevantFiles(
    tokens: string[],
    projectPath: string | undefined,
    limitations: string[],
    settings: DepthSettings
  ) {
    return this.safeQuery(() => this.queryFiles(tokens, projectPath, settings.fileLimit), "File.path", limitations);
  }

  private async findRelevantImports(
    tokens: string[],
    projectPath: string | undefined,
    limitations: string[],
    settings: DepthSettings
  ) {
    const imports = new Map<string, OrbitImport>();
    const importPathRows = await this.safeQuery(
      () => this.queryImports("import_path", tokens, projectPath, settings.importLimit),
      "ImportedSymbol.import_path",
      limitations
    );
    const filePathRows = await this.safeQuery(
      () => this.queryImports("file_path", tokens, projectPath, Math.ceil(settings.importLimit / 2)),
      "ImportedSymbol.file_path",
      limitations
    );

    for (const item of [...importPathRows, ...filePathRows]) {
      imports.set(item.id, item);
    }

    return [...imports.values()];
  }

  private async findRelevantGitLabFiles(
    tokens: string[],
    projectPath: string,
    limitations: string[],
    settings: DepthSettings
  ) {
    const files = new Map<string, OrbitFile>();
    const searchTerms = unique(coreSearchTokens(tokens).length > 0 ? coreSearchTokens(tokens) : tokens)
      .filter((token) => token.length >= 3)
      .slice(0, 6);

    for (const term of searchTerms) {
      try {
        const rows = await this.queryGitLabBlobSearch(projectPath, term, Math.max(8, Math.ceil(settings.fileLimit / 2)));
        for (const file of rows) {
          if (pathSignalScore(file.path, tokens) > 0) {
            files.set(normalizePath(file.path), file);
          }
        }
      } catch (error) {
        limitations.push(`GitLab source search for "${term}" was skipped: ${sanitizeError(error)}.`);
      }
    }

    const recovered = [...files.values()]
      .sort((a, b) => pathSignalScore(b.path, tokens) - pathSignalScore(a.path, tokens))
      .slice(0, settings.fileLimit);

    if (recovered.length > 0) {
      limitations.push("Orbit definition traversal returned no files, so Navix recovered real files through GitLab repository search.");
    }

    return recovered;
  }

  private async queryGitLabBlobSearch(projectPath: string, term: string, limit: number): Promise<OrbitFile[]> {
    const url = new URL(`${this.gitlabBaseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/search`);
    url.searchParams.set("scope", "blobs");
    url.searchParams.set("search", term);
    url.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 100)));

    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (this.gitlabToken) {
      headers["PRIVATE-TOKEN"] = this.gitlabToken;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitLab search failed with ${response.status}: ${await safeResponseText(response)}`);
    }

    const rows = await response.json().catch(() => []) as unknown;
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row): OrbitFile | undefined => {
        if (!isRecord(row)) {
          return undefined;
        }
        const path = stringValue(row, "path") ?? stringValue(row, "filename");
        if (!path) {
          return undefined;
        }
        const extension = path.includes(".") ? path.split(".").at(-1) : undefined;
        return {
          id: `gitlab:${stableHash(path)}`,
          path,
          name: basename(path),
          ...(extension ? { extension } : {})
        } satisfies OrbitFile;
      })
      .filter((value): value is OrbitFile => Boolean(value));
  }

  private async queryDefinitions(
    property: "name" | "file_path" | "fqn",
    tokens: string[],
    projectPath: string | undefined,
    limit: number
  ) {
    const definitionSelector = {
      id: "def",
      entity: "Definition",
      filters: {
        [property]: tokenFilter(tokens)
      },
      columns: definitionColumns
    };

    const query = projectPath
      ? {
          query_type: "traversal",
          nodes: [
            {
              id: "project",
              entity: "Project",
              filters: { full_path: projectPath },
              columns: ["id", "name", "full_path"]
            },
            {
              id: "branch",
              entity: "Branch",
              filters: { is_default: true },
              columns: ["id", "name", "is_default"]
            },
            {
              id: "file",
              entity: "File",
              columns: fileColumns
            },
            definitionSelector
          ],
          relationships: [
            { type: "IN_PROJECT", from: "branch", to: "project" },
            { type: "ON_BRANCH", from: "file", to: "branch" },
            { type: "DEFINES", from: "file", to: "def" }
          ],
          limit
        }
      : {
          query_type: "traversal",
          node: definitionSelector,
          limit
        };

    const response = await this.orbitQuery(query);
    return extractRows(response)
      .map((row) => this.definitionFromRow(row))
      .filter((value): value is OrbitDefinition => Boolean(value));
  }

  private async queryProject(projectPath: string) {
    const response = await this.orbitQuery({
      query_type: "traversal",
      node: {
        id: "project",
        entity: "Project",
        filters: { full_path: projectPath },
        columns: ["id", "name", "full_path"]
      },
      limit: 1
    });

    return extractRows(response);
  }

  private async queryFiles(tokens: string[], projectPath: string | undefined, limit: number) {
    const fileSelector = {
      id: "file",
      entity: "File",
      filters: {
        path: tokenFilter(tokens)
      },
      columns: fileColumns
    };

    const query = projectPath
      ? {
          query_type: "traversal",
          nodes: [
            {
              id: "project",
              entity: "Project",
              filters: { full_path: projectPath },
              columns: ["id", "name", "full_path"]
            },
            {
              id: "branch",
              entity: "Branch",
              filters: { is_default: true },
              columns: ["id", "name", "is_default"]
            },
            fileSelector
          ],
          relationships: [
            { type: "IN_PROJECT", from: "branch", to: "project" },
            { type: "ON_BRANCH", from: "file", to: "branch" }
          ],
          limit
        }
      : {
          query_type: "traversal",
          node: fileSelector,
          limit
        };

    const response = await this.orbitQuery(query);
    return extractRows(response)
      .map((row) => this.fileFromRow(row))
      .filter((value): value is OrbitFile => Boolean(value));
  }

  private async queryImports(
    property: "file_path" | "import_path",
    tokens: string[],
    projectPath: string | undefined,
    limit: number
  ) {
    const importSelector = {
      id: "imp",
      entity: "ImportedSymbol",
      filters: {
        [property]: tokenFilter(tokens)
      },
      columns: importColumns
    };

    const query = projectPath
      ? {
          query_type: "traversal",
          nodes: [
            {
              id: "project",
              entity: "Project",
              filters: { full_path: projectPath },
              columns: ["id", "name", "full_path"]
            },
            {
              id: "branch",
              entity: "Branch",
              filters: { is_default: true },
              columns: ["id", "name", "is_default"]
            },
            {
              id: "file",
              entity: "File",
              columns: fileColumns
            },
            importSelector
          ],
          relationships: [
            { type: "IN_PROJECT", from: "branch", to: "project" },
            { type: "ON_BRANCH", from: "file", to: "branch" },
            { type: "IMPORTS", from: "file", to: "imp" }
          ],
          limit
        }
      : {
          query_type: "traversal",
          node: importSelector,
          limit
        };

    const response = await this.orbitQuery(query);
    return extractRows(response)
      .map((row) => this.importFromRow(row))
      .filter((value): value is OrbitImport => Boolean(value));
  }

  private async queryDefinitionCalls(definitionIds: string[], settings: DepthSettings) {
    if (definitionIds.length === 0) {
      return [];
    }

    const response = await this.orbitQuery({
      query_type: "traversal",
      nodes: [
        {
          id: "source",
          entity: "Definition",
          node_ids: definitionIds.slice(0, settings.callSourceLimit),
          columns: definitionColumns
        },
        {
          id: "target",
          entity: "Definition",
          columns: definitionColumns
        }
      ],
      relationships: [{ type: "CALLS", from: "source", to: "target" }],
      limit: settings.callLimit
    });

    return extractRows(response);
  }

  private buildComponents(
    definitions: OrbitDefinition[],
    files: OrbitFile[],
    tokens: string[],
    settings: DepthSettings
  ): ComponentRecord[] {
    const byPath = new Map<string, OrbitDefinition[]>();

    for (const definition of definitions) {
      const path = definition.filePath ?? `definition:${definition.id}`;
      byPath.set(path, [...(byPath.get(path) ?? []), definition]);
    }

    const components: ComponentRecord[] = [...byPath.entries()].map(([filePath, items]) => {
      const primary = choosePrimaryDefinition(items, tokens);
      const type = classifyRole(filePath, primary.name);
      const definitionNames = unique(items.map((item) => item.name).filter(Boolean));

      return {
        id: componentId(filePath),
        label: labelForComponent(filePath, primary.name, type),
        type,
        filePath,
        summary: summaryForDefinitions(filePath, items, type, tokens),
        indexedDefinitions: definitionNames,
        importanceScore: scoreComponent(type, filePath, definitionNames, tokens, items.length),
        dependencies: [],
        relatedTests: [],
        tags: tagsForComponent(type, filePath, tokens),
        definitionIds: items.map((item) => item.id),
        definitionNames
      };
    });

    const knownPaths = new Set([...byPath.keys()].map(normalizePath));
    const extraFiles = files.filter((file) => {
      return !knownPaths.has(normalizePath(file.path)) && pathSignalScore(file.path, tokens) > 0;
    });

    for (const file of extraFiles) {
      const type = classifyRole(file.path, file.name);
      components.push({
        id: componentId(file.path),
        label: labelForComponent(file.path, file.name ?? basename(file.path), type),
        type,
        filePath: file.path,
        summary: summaryForFile(file, type, tokens),
        indexedDefinitions: file.name ? [file.name] : [basename(file.path)],
        importanceScore: scoreComponent(type, file.path, [file.name ?? basename(file.path)], tokens, 1),
        dependencies: [],
        relatedTests: [],
        tags: tagsForComponent(type, file.path, tokens),
        definitionIds: [],
        definitionNames: []
      });
    }

    if (components.length === 0) {
      for (const file of files) {
        const type = classifyRole(file.path, file.name);
        components.push({
          id: componentId(file.path),
          label: labelForComponent(file.path, file.name ?? basename(file.path), type),
          type,
          filePath: file.path,
          summary: summaryForFile(file, type, tokens),
          indexedDefinitions: file.name ? [file.name] : [basename(file.path)],
          importanceScore: scoreComponent(type, file.path, [file.name ?? basename(file.path)], tokens, 1),
          dependencies: [],
          relatedTests: [],
          tags: tagsForComponent(type, file.path, tokens),
          definitionIds: [],
          definitionNames: []
        });
      }
    }

    return selectComponents(components, settings.componentLimit, settings.testFocused);
  }

  private async buildDependencies(
    components: ComponentRecord[],
    imports: OrbitImport[],
    limitations: string[],
    settings: DepthSettings
  ) {
    const edges = new Map<string, OrbitDependency>();
    const componentByDefinitionId = new Map<string, ComponentRecord>();
    const componentByPath = new Map<string, ComponentRecord>();

    for (const component of components) {
      this.lastComponents.set(component.id, component);
      if (component.filePath) {
        componentByPath.set(normalizePath(component.filePath), component);
      }
      for (const definitionId of component.definitionIds) {
        componentByDefinitionId.set(definitionId, component);
      }
    }

    const callRows = settings.includeCalls
      ? await this.safeQuery(
          () => this.queryDefinitionCalls([...componentByDefinitionId.keys()], settings),
          "Definition.CALLS",
          limitations
        )
      : [];

    for (const row of callRows) {
      const source = entityFromRow(row, "source");
      const target = entityFromRow(row, "target");
      if (!source || !target) {
        continue;
      }

      const sourceComponent = componentByDefinitionId.get(source.id);
      const targetComponent = componentByDefinitionId.get(target.id);
      if (!sourceComponent || !targetComponent || sourceComponent.id === targetComponent.id) {
        continue;
      }

      addEdge(edges, sourceComponent.id, targetComponent.id, `calls ${targetComponent.label}`, "execution", {
        source: "orbit-call",
        detail: `Orbit CALLS relationship from ${sourceComponent.label} to ${targetComponent.label}.`
      });
    }

    for (const item of imports) {
      const sourceComponent = item.filePath
        ? componentByPath.get(normalizePath(item.filePath))
        : undefined;
      const targetComponent = matchImportTarget(item, components);

      if (!sourceComponent || !targetComponent || sourceComponent.id === targetComponent.id) {
        continue;
      }

      addEdge(
        edges,
        sourceComponent.id,
        targetComponent.id,
        item.identifierName ? `imports ${item.identifierName}` : "imports",
        "dependency",
        {
          source: "orbit-import",
          detail: item.identifierName
            ? `Orbit import matched ${item.identifierName} in ${sourceComponent.filePath ?? sourceComponent.label}.`
            : `Orbit import matched ${item.importPath ?? "an imported symbol"} in ${sourceComponent.filePath ?? sourceComponent.label}.`
        }
      );
    }

    addTestEdges(edges, components);
    addModuleContextEdges(edges, components);
    const collapsedEdges = collapseEdges([...edges.values()]);
    applyEdgeMetadata(components, collapsedEdges);

    return collapsedEdges.slice(0, 40);
  }

  private refreshDetailsCache(components: ComponentRecord[], dependencies: OrbitDependency[]) {
    const byId = new Map(components.map((component) => [component.id, componentToGraphNode(component)]));

    for (const component of components) {
      const node = componentToGraphNode(component);
      const outgoing = dependencies
        .filter((edge) => edge.source === component.id)
        .map((edge) => byId.get(edge.target))
        .filter((value): value is GraphNode => Boolean(value));
      const incoming = dependencies
        .filter((edge) => edge.target === component.id)
        .map((edge) => byId.get(edge.source))
        .filter((value): value is GraphNode => Boolean(value));
      const relatedTests = components
        .filter((candidate) => {
          return candidate.type === "test" && dependencies.some((edge) => {
            return edge.source === candidate.id && edge.target === component.id;
          });
        })
        .map(componentToGraphNode);
      const uniqueOutgoing = uniqueGraphNodes(outgoing);
      const uniqueIncoming = uniqueGraphNodes(incoming);
      const uniqueRelatedTests = uniqueGraphNodes(relatedTests);

      this.detailsCache.set(component.id, {
        id: component.id,
        label: component.label,
        type: component.type,
        filePath: component.filePath,
        summary: component.summary,
        purpose: purposeForComponent(component, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        indexedDefinitions: component.definitionNames,
        onboardingNotes: onboardingNotesForComponent(component, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        inspectionQuestions: inspectionQuestionsForComponent(component, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests),
        dependencies: uniqueOutgoing,
        dependents: uniqueIncoming,
        relatedTests: uniqueRelatedTests,
        relationshipEvidence: relationshipEvidenceForComponent(component, dependencies, byId),
        evidence: evidenceForComponent(component, uniqueOutgoing, uniqueIncoming, uniqueRelatedTests, dependencies),
        tags: node.tags ?? []
      });
    }
  }

  private definitionFromRow(row: Record<string, unknown>): OrbitDefinition | undefined {
    const definition = entityFromRow(row, "def") ?? entityFromRow(row, "source") ?? entityFromRow(row, "target");
    const file = entityFromRow(row, "file");
    if (!definition) {
      return undefined;
    }

    const props = definition.properties;
    const id = stringValue(props, "id") ?? definition.id;
    const name = stringValue(props, "name") ?? stringValue(props, "fqn") ?? `Definition ${id}`;
    const filePath = stringValue(props, "file_path") ?? stringValue(file?.properties, "path");

    return {
      id,
      name,
      fqn: stringValue(props, "fqn"),
      definitionType: stringValue(props, "definition_type"),
      filePath,
      startLine: numberValue(props, "start_line"),
      endLine: numberValue(props, "end_line")
    };
  }

  private fileFromRow(row: Record<string, unknown>): OrbitFile | undefined {
    const file = entityFromRow(row, "file");
    if (!file) {
      return undefined;
    }

    const props = file.properties;
    const id = stringValue(props, "id") ?? file.id;
    const path = stringValue(props, "path") ?? stringValue(props, "file_path");
    if (!path) {
      return undefined;
    }

    return {
      id,
      path,
      name: stringValue(props, "name"),
      language: stringValue(props, "language"),
      extension: stringValue(props, "extension")
    };
  }

  private importFromRow(row: Record<string, unknown>): OrbitImport | undefined {
    const imported = entityFromRow(row, "imp");
    if (!imported) {
      return undefined;
    }

    const props = imported.properties;
    const id = stringValue(props, "id") ?? imported.id;

    return {
      id,
      filePath: stringValue(props, "file_path"),
      importPath: stringValue(props, "import_path"),
      importType: stringValue(props, "import_type"),
      identifierName: stringValue(props, "identifier_name"),
      identifierAlias: stringValue(props, "identifier_alias")
    };
  }

  private async safeQuery<T>(
    run: () => Promise<T[]>,
    label: string,
    limitations: string[]
  ): Promise<T[]> {
    try {
      return await run();
    } catch (error) {
      limitations.push(`${label} query was skipped: ${sanitizeError(error)}.`);
      return [];
    }
  }

  private async orbitQuery(query: unknown): Promise<OrbitQueryEnvelope> {
    const response = await this.sendOrbitRequestWithRetry({ query, response_format: "raw" });

    if (response.ok) {
      return (await response.json()) as OrbitQueryEnvelope;
    }

    if (response.status === 400) {
      const retry = await this.sendOrbitRequestWithRetry({ query, format: "raw" });
      if (retry.ok) {
        return (await retry.json()) as OrbitQueryEnvelope;
      }
      throw new Error(`Orbit query failed with ${retry.status}: ${await safeResponseText(retry)}`);
    }

    if (response.status === 401 || response.status === 403) {
      const retry = await this.sendOrbitRequestWithRetry(
        { query, response_format: "raw" },
        "PRIVATE-TOKEN"
      );
      if (retry.ok) {
        return (await retry.json()) as OrbitQueryEnvelope;
      }
      throw new Error(`Orbit authentication failed with ${retry.status}. Check token scope and Orbit access.`);
    }

    throw new Error(`Orbit query failed with ${response.status}: ${await safeResponseText(response)}`);
  }

  private async sendOrbitRequestWithRetry(body: unknown, authStyle: "bearer" | "PRIVATE-TOKEN" = "bearer") {
    let response = await this.sendOrbitRequest(body, authStyle);
    for (let attempt = 1; attempt < 3 && isTransientOrbitStatus(response.status); attempt += 1) {
      await delay(350 * attempt);
      response = await this.sendOrbitRequest(body, authStyle);
    }
    return response;
  }

  private async sendOrbitRequest(body: unknown, authStyle: "bearer" | "PRIVATE-TOKEN" = "bearer") {
    const url = `${this.normalizedApiUrl()}/query`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };

    if (authStyle === "PRIVATE-TOKEN") {
      headers["PRIVATE-TOKEN"] = this.apiKey ?? "";
    } else {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), orbitRequestTimeoutMs);

    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizedApiUrl() {
    return (this.apiUrl ?? "").replace(/\/+$/, "");
  }

  private assertConfigured() {
    if (!this.apiUrl || !this.apiKey) {
      throw new Error("ORBIT_API_URL and either ORBIT_API_KEY or GITLAB_TOKEN are required when ORBIT_PROVIDER=orbit.");
    }
  }
}

const extractRows = (response: OrbitQueryEnvelope): Array<Record<string, unknown>> => {
  const result = response.result;

  if (Array.isArray(result)) {
    return result.filter(isRecord);
  }

  if (isRecord(result)) {
    const rows = result.rows;
    if (Array.isArray(rows)) {
      return rows.filter(isRecord);
    }

    const nodes = result.nodes;
    if (Array.isArray(nodes)) {
      return nodes.filter(isRecord);
    }
  }

  return [];
};

const entityFromRow = (row: Record<string, unknown>, alias: string): OrbitEntity | undefined => {
  const selfId = stringValue(row, "id");
  const selfType = stringValue(row, "type");
  if (selfId && selfType) {
    return {
      id: selfId,
      type: selfType,
      properties: {
        ...row,
        id: selfId
      }
    };
  }

  const direct = row[alias];
  if (isRecord(direct)) {
    const props = isRecord(direct.properties) ? direct.properties : direct;
    const id = stringValue(direct, "id") ?? stringValue(props, "id");
    const type = stringValue(direct, "type") ?? stringValue(direct, "entity") ?? alias;

    if (id) {
      return {
        id,
        type,
        properties: {
          ...props,
          id
        }
      };
    }
  }

  const prefixed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(`${alias}_`)) {
      prefixed[key.slice(alias.length + 1)] = value;
    }
  }

  const id = stringValue(prefixed, "id");
  if (!id) {
    return undefined;
  }

  return {
    id,
    type: stringValue(prefixed, "type") ?? alias,
    properties: prefixed
  };
};

const buildSearchTokens = (input: PromptIntent) => {
  const baseTokens = `${input.feature} ${input.rawPrompt}`
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !stopWords.has(token));

  const expanded = new Set(baseTokens);
  const joined = baseTokens.join(" ");

  if (/\b(auth|authentic|authenticate|authentication|authorization|authorize|login|session|token|password|credential|jwt|claim)\b/.test(joined)) {
    [
      "auth",
      "authentication",
      "authorization",
      "login",
      "session",
      "token",
      "password",
      "credential",
      "jwt",
      "claim",
      "claims",
      "identity"
    ].forEach((token) =>
      expanded.add(token)
    );
  }

  if (/\b(checkout|cart|payment|billing|order|purchase|inventory)\b/.test(joined)) {
    ["checkout", "cart", "payment", "billing", "order", "purchase", "inventory"].forEach((token) =>
      expanded.add(token)
    );
  }

  if (input.intent === "test_coverage_view") {
    ["test", "tests", "spec", "coverage", "_test"].forEach((token) => expanded.add(token));
  }

  return [...expanded].slice(0, input.intent === "test_coverage_view" ? 18 : 14);
};

const parseProjectPath = (repoUrl?: string) => {
  if (!repoUrl) {
    return undefined;
  }

  const trimmed = repoUrl.trim().replace(/\.git$/, "");

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return path || undefined;
  } catch {
    return trimmed.includes("/") ? trimmed.replace(/^\/+|\/+$/g, "") : undefined;
  }
};

const settingsForDepth = (depth: number, intent: PromptIntent["intent"] = "architecture_flow"): DepthSettings => {
  const normalizedDepth = Math.min(Math.max(Math.round(depth), 1), 4);
  const testFocused = intent === "test_coverage_view";
  const definitionSearches: Array<"name" | "file_path" | "fqn"> =
    normalizedDepth === 1
      ? ["name"]
      : normalizedDepth === 2
        ? ["name", "file_path"]
        : ["name", "file_path", "fqn"];

  return {
    depth: normalizedDepth,
    testFocused,
    definitionSearches,
    definitionLimit: ([0, 16, 32, 48, 72][normalizedDepth] ?? 32) + (testFocused ? 8 : 0),
    fileLimit: ([0, 8, 16, 28, 40][normalizedDepth] ?? 16) + (testFocused ? 18 : 0),
    importLimit: [0, 0, 24, 56, 96][normalizedDepth] ?? 24,
    componentLimit: ([0, 8, 14, 20, 28][normalizedDepth] ?? 14) + (testFocused ? 4 : 0),
    callSourceLimit: [0, 0, 0, 60, 120][normalizedDepth] ?? 0,
    callLimit: [0, 0, 0, 90, 180][normalizedDepth] ?? 0,
    includeImports: normalizedDepth >= 2,
    includeCalls: normalizedDepth >= 3
  };
};

const tokenFilter = (tokens: string[]) => ({
  op: "any_tokens",
  value: tokens.join(" ")
});

const classifyRole = (filePath?: string, name?: string): ArchitectureNodeType => {
  const source = `${filePath ?? ""} ${name ?? ""}`.toLowerCase();

  if (/(^|[/_.-])(test|tests|spec|specs|__tests__|integration-tests|fixtures)([/_.-]|$)|\.(test|spec)\./.test(source)) {
    return "test";
  }
  if (/\b(controller|handler|resolver)\b/.test(source)) {
    return "controller";
  }
  if (/\b(service|manager|usecase|interactor)\b/.test(source)) {
    return "service";
  }
  if (/\b(route|router|api|client|endpoint)\b/.test(source)) {
    return "api";
  }
  if (/\b(page|view|component|screen|tsx|jsx)\b/.test(source)) {
    return "ui";
  }
  if (/\b(model|entity|schema|repository|dao|record)\b/.test(source)) {
    return "model";
  }
  if (/\b(db|database|migration|table|store)\b/.test(source)) {
    return "database";
  }
  if (/\b(config|settings|env)\b/.test(source)) {
    return "config";
  }
  if (/\b(http|grpc|external|gateway|provider)\b/.test(source)) {
    return "external";
  }

  return "utility";
};

const choosePrimaryDefinition = (items: OrbitDefinition[], tokens: string[]) => {
  return [...items].sort((a, b) => definitionMatchScore(b, tokens) - definitionMatchScore(a, tokens))[0] ?? items[0]!;
};

const definitionMatchScore = (definition: OrbitDefinition, tokens: string[]) => {
  const haystack = `${definition.name} ${definition.fqn ?? ""} ${definition.filePath ?? ""}`.toLowerCase();
  const coreTokens = coreSearchTokens(tokens);
  const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? tokenWeight(token) : 0), 0);
  const coreScore = coreTokens.reduce((score, token) => score + (haystack.includes(token) ? 8 : 0), 0);
  return tokenScore + coreScore + pathSignalScore(definition.filePath, tokens) - noisePenalty(definition.filePath, definition.name);
};

const scoreComponent = (
  type: ArchitectureNodeType,
  filePath: string | undefined,
  names: string[],
  tokens: string[],
  definitionCount: number
) => {
  const haystack = `${filePath ?? ""} ${names.join(" ")}`.toLowerCase();
  const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? tokenWeight(token) : 0), 0);
  const pathScore = pathSignalScore(filePath, tokens);
  const countScore = Math.min(definitionCount, 6) * 2;
  const penalty = noisePenalty(filePath, names.join(" "));
  const testIntentBonus = type === "test" && tokens.some((token) => /^(test|tests|spec|coverage|_test)$/.test(token)) ? 45 : 0;

  return Math.min(100, Math.max(1, roleWeights[type] + tokenScore + pathScore + countScore + testIntentBonus - penalty - 20));
};

const summaryForDefinitions = (
  filePath: string,
  items: OrbitDefinition[],
  type: ArchitectureNodeType,
  tokens: string[]
) => {
  const names = unique(items.map((item) => item.name).filter(Boolean)).slice(0, 4);
  const lines = compactLineRange(items);
  const definitionPhrase = names.length > 0
    ? `Orbit indexed ${names.join(", ")}${items.length > names.length ? " and related symbols" : ""}`
    : `Orbit indexed ${items.length} symbol${items.length === 1 ? "" : "s"}`;
  const linePhrase = lines ? ` around ${lines.toLowerCase()}` : "";
  const guidance = roleSummary(type);
  const concern = concernSummary(filePath, names, type, tokens);

  return `${concern.roleSentence} Orbit grounded it in ${filePath}. ${definitionPhrase}${linePhrase}. Read it for ${concern.readFor}; before changing it, check ${concern.changeImpact}.`;
};

const summaryForFile = (file: OrbitFile, type: ArchitectureNodeType, tokens: string[]) => {
  const concern = concernSummary(file.path, [file.name ?? basename(file.path)], type, tokens);
  const language = file.language ? ` Orbit identified this as a ${file.language} source file.` : "";
  return `${concern.roleSentence} Orbit grounded it in ${file.path}.${language} Read it for ${concern.readFor}; before changing it, check ${concern.changeImpact}.`;
};

const purposeForComponent = (
  component: ComponentRecord,
  outgoing: GraphNode[],
  incoming: GraphNode[],
  relatedTests: GraphNode[]
) => {
  const guidance = roleSummary(component.type);
  const relationships = relationshipSummary(outgoing, incoming);
  const tests = relatedTests.length > 0
    ? ` Related tests in this graph: ${formatNodeLabels(relatedTests)}.`
    : " No related test node appeared in this graph depth.";

  return `${component.label} matters as ${withArticle(guidance.noun)} for this slice. ${relationships} ${guidance.editRisk}${tests}`;
};

const onboardingNotesForComponent = (
  component: ComponentRecord,
  outgoing: GraphNode[],
  incoming: GraphNode[],
  relatedTests: GraphNode[]
) => {
  const notes: string[] = [];

  if (component.tags?.includes("entrypoint")) {
    notes.push("Start here because Orbit tagged this file as an entry point for the prompt.");
  }

  if (component.filePath) {
    notes.push(`Open ${component.filePath} first so the graph has a concrete source anchor.`);
  }

  if (component.definitionNames.length > 0) {
    notes.push(`Read these indexed definitions before scanning the rest of the file: ${component.definitionNames.slice(0, 5).join(", ")}.`);
  }

  if (outgoing.length > 0) {
    notes.push(`Then follow outgoing relationships to ${formatNodeLabels(outgoing)}.`);
  }

  if (incoming.length > 0) {
    notes.push(`Review incoming dependents from ${formatNodeLabels(incoming)} before changing public behavior here.`);
  }

  if (relatedTests.length > 0) {
    notes.push(`Use ${formatNodeLabels(relatedTests)} as your first behavior check.`);
  }

  if (notes.length === 0) {
    notes.push("This node has no rendered neighbors at the current depth; inspect the source file and regenerate with a deeper graph if needed.");
  }

  return notes;
};

const inspectionQuestionsForComponent = (
  component: ComponentRecord,
  outgoing: GraphNode[],
  incoming: GraphNode[],
  relatedTests: GraphNode[]
) => {
  const guidance = roleSummary(component.type);
  const questions = [guidance.question];

  questions.push(
    outgoing.length > 0
      ? `What assumptions does it pass to ${formatNodeLabels(outgoing)}?`
      : "Is this a leaf in the current map, or did the selected depth hide the next hop?"
  );

  if (incoming.length > 0) {
    questions.push(
      incoming.length === 1
        ? `What behavior does ${formatNodeLabels(incoming)} expect from this node?`
        : `What behavior do ${formatNodeLabels(incoming)} expect from this node?`
    );
  }

  questions.push(
    relatedTests.length > 0
      ? `Which scenario in ${formatNodeLabels(relatedTests)} would fail if this node changed?`
      : "Where is the closest test or fixture that proves this behavior?"
  );

  return questions;
};

const relationshipSummary = (outgoing: GraphNode[], incoming: GraphNode[]) => {
  if (outgoing.length > 0 && incoming.length > 0) {
    return `It receives flow from ${formatNodeLabels(incoming)} and hands work to ${formatNodeLabels(outgoing)}.`;
  }

  if (outgoing.length > 0) {
    return `It hands work to ${formatNodeLabels(outgoing)}.`;
  }

  if (incoming.length > 0) {
    return `It is used by ${formatNodeLabels(incoming)}.`;
  }

  return "Orbit did not expose rendered neighbors for it at this depth.";
};

const roleSummary = (type: ArchitectureNodeType) => {
  const guidance: Record<ArchitectureNodeType, {
    noun: string;
    focus: string;
    editRisk: string;
    question: string;
  }> = {
    ui: {
      noun: "user-facing entry surface",
      focus: "the user action, local state, and downstream request it triggers",
      editRisk: "Changes here can alter the visible workflow and the request shape sent downstream.",
      question: "What user action or screen state causes this code to run?"
    },
    controller: {
      noun: "request-routing boundary",
      focus: "validation, request mapping, service handoff, and response/error translation",
      editRisk: "Changes here can alter the caller-facing contract before core logic changes.",
      question: "Which inputs are validated here before the flow enters core logic?"
    },
    service: {
      noun: "coordination layer",
      focus: "the main decision path, dependency order, and rules that tie collaborators together",
      editRisk: "Changes here usually carry broad behavior impact because this layer coordinates several dependencies.",
      question: "Which branch or dependency call represents the main business decision?"
    },
    model: {
      noun: "data boundary",
      focus: "state shape, persistence assumptions, validation rules, and fields other components rely on",
      editRisk: "Changes here can ripple into services, API payloads, migrations, and tests.",
      question: "Which fields or invariants are other nodes relying on?"
    },
    api: {
      noun: "API or client boundary",
      focus: "the request/response contract, error handling, authentication assumptions, and service call shape",
      editRisk: "Changes here can break callers even when the underlying implementation still works.",
      question: "What contract is this node exposing or consuming?"
    },
    database: {
      noun: "persistence boundary",
      focus: "stored state, schema constraints, migrations, and assumptions made by data-access code",
      editRisk: "Changes here can affect historical data and every reader or writer using the same storage.",
      question: "Which code paths read or write this stored state?"
    },
    test: {
      noun: "behavioral safety net",
      focus: "expected behavior, edge cases, fixtures, and regression signals",
      editRisk: "Changes here alter what behavior the team can trust during refactors.",
      question: "Which behavior is this test proving, and which production node does it protect?"
    },
    config: {
      noun: "configuration boundary",
      focus: "runtime defaults, environment-driven behavior, feature flags, and setup values consumed elsewhere",
      editRisk: "Changes here can alter behavior across environments without touching the core flow.",
      question: "Which defaults or environment values change downstream behavior?"
    },
    utility: {
      noun: "shared support module",
      focus: "reusable transformations, helper behavior, and low-level assumptions imported elsewhere",
      editRisk: "Changes here can be deceptively wide because several paths may reuse the same helper behavior.",
      question: "Which callers reuse this behavior, and do they need the same assumptions?"
    },
    external: {
      noun: "external-system boundary",
      focus: "protocol details, third-party assumptions, timeout/error handling, and exchanged data",
      editRisk: "Changes here can affect integration reliability outside the repository.",
      question: "What can fail outside this repository, and how is that failure represented here?"
    }
  };

  return guidance[type];
};

const coreSearchTokens = (tokens: string[]) => {
  const tokenSet = new Set(tokens);

  if ([...tokenSet].some((token) => /^(auth|authentic|authentication|authorization|login|session|jwt|claims?)$/.test(token))) {
    return [
      "auth",
      "authentication",
      "authorization",
      "login",
      "session",
      "token",
      "jwt",
      "claim",
      "claims",
      "credential",
      "identity"
    ];
  }

  return tokens.filter((token) => !genericTokens.has(token));
};

const genericTokens = new Set(["app", "code", "flow", "id", "main", "node", "query", "repo", "system", "user"]);

const tokenWeight = (token: string) => {
  if (genericTokens.has(token)) {
    return 1;
  }

  if (/^(auth|authentication|authorization|login|session|token|jwt|claims?|credential|identity)$/.test(token)) {
    return 7;
  }

  return 4;
};

const pathSignalScore = (filePath: string | undefined, tokens: string[]) => {
  if (!filePath) {
    return 0;
  }

  const normalizedPath = normalizePath(filePath);
  const normalizedTerms = normalizeForMatch(filePath).split(" ");
  const coreTokens = coreSearchTokens(tokens);
  const authPrompt = coreTokens.includes("auth");
  let score = 0;

  if (authPrompt) {
    if (/(^|\/)(auth|authentication|authorization)(\/|_|-|\.|$)/.test(normalizedPath)) {
      score += 45;
    }

    if (/\b(jwt|claims?|session|credential|password|identity)\b/.test(normalizedTerms.join(" "))) {
      score += 24;
    }

    if (/\btoken\b/.test(normalizedTerms.join(" ")) && /(^|\/)(auth|authentication|authorization)(\/|_|-|\.|$)|\b(jwt|session|credential|password|identity|claims?)\b/.test(normalizedPath)) {
      score += 10;
    }

    return Math.min(score, 60);
  }

  for (const token of coreTokens) {
    if (normalizedTerms.includes(token)) {
      score += 18;
    } else if (normalizedPath.includes(`/${token}`) || normalizedPath.includes(`${token}/`) || normalizedPath.includes(`_${token}`)) {
      score += 12;
    } else if (normalizedPath.includes(token)) {
      score += 5;
    }
  }

  return Math.min(score, 60);
};

const noisePenalty = (filePath: string | undefined, namesText = "") => {
  const haystack = `${filePath ?? ""} ${namesText}`.toLowerCase();
  let penalty = 0;

  if (/(^|\/)(fixtures?|examples?|sample|mock|generated)(\/|$)/.test(haystack)) {
    penalty += 58;
  }

  if (/(^|\/)(integration-tests|tests?|specs?)(\/|$)|\.(test|spec)\./.test(haystack)) {
    penalty += 28;
  }

  if (/(^|\/)(\.claude|docs?|scripts?|tools?)(\/|$)/.test(haystack)) {
    penalty += 38;
  }

  if (/(^|\/)main\.[a-z0-9]+$/.test(haystack) && !/(^|\/)(auth|authentication|authorization)(\/|_|-|\.|$)/.test(haystack)) {
    penalty += 22;
  }

  if (/\b(ch_user|user_id|created_by|updated_by|modified_by)\b/.test(haystack)) {
    penalty += 12;
  }

  return penalty;
};

const concernSummary = (
  filePath: string,
  names: string[],
  type: ArchitectureNodeType,
  tokens: string[]
) => {
  const guidance = roleSummary(type);
  const normalized = `${filePath} ${names.join(" ")}`.toLowerCase();
  const isAuthPrompt = coreSearchTokens(tokens).includes("auth");
  const definitionPhrase = names.length > 0 ? ` through ${names.slice(0, 3).join(", ")}` : "";

  if (isAuthPrompt && /\b(claims?|jwt|token|session|credential|identity)\b/.test(normalizeForMatch(normalized))) {
    return {
      roleSentence: `${capitalize(basename(filePath))} is an authentication context boundary${definitionPhrase}: it is where identity, token, session, or claim-related concepts surface in this repository slice.`,
      readFor: "the exact identity fields, token assumptions, and session values other code may trust",
      changeImpact: "callers, tests, and API boundaries that parse or depend on the same identity contract"
    };
  }

  if (isAuthPrompt && /(^|\/)(auth|authentication|authorization)(\/|_|-|\.|$)/.test(normalizePath(filePath))) {
    return {
      roleSentence: `${capitalize(basename(filePath))} sits inside the authentication area of the codebase${definitionPhrase}.`,
      readFor: `how this ${guidance.noun} participates in authentication and where the flow crosses module boundaries`,
      changeImpact: "nearby auth modules first, then any rendered dependents or tests before editing behavior"
    };
  }

  if (type === "test") {
    return {
      roleSentence: `${capitalize(basename(filePath))} is a test or fixture node connected to the requested slice${definitionPhrase}.`,
      readFor: "expected behavior, setup data, and regression cases around the mapped feature",
      changeImpact: "which production node this test protects and whether the assertion still matches the intended behavior"
    };
  }

  if (type === "api" || /\b(client|grpc|http|endpoint|route)\b/.test(normalized)) {
    return {
      roleSentence: `${capitalize(basename(filePath))} is an API or integration boundary${definitionPhrase}.`,
      readFor: "request and response shape, authentication assumptions, error handling, and the next system boundary",
      changeImpact: "both sides of the contract: callers upstream and services or external systems downstream"
    };
  }

  return {
    roleSentence: `${capitalize(basename(filePath))} is ${withArticle(guidance.noun)} in this mapped slice${definitionPhrase}.`,
    readFor: guidance.focus,
    changeImpact: "callers, dependents, and tests that assume the same behavior"
  };
};

const selectComponents = (components: ComponentRecord[], limit: number, testFocused = false) => {
  const ranked = [...components].sort((a, b) => b.importanceScore - a.importanceScore);
  const production = ranked.filter((component) => component.type !== "test");
  const tests = ranked.filter((component) => component.type === "test");

  if (production.length === 0) {
    return ranked.slice(0, limit);
  }

  const maxTests = Math.min(tests.length, testFocused ? Math.max(4, Math.floor(limit * 0.4)) : Math.max(1, Math.floor(limit * 0.2)));
  const selected = new Map<string, ComponentRecord>();

  for (const component of production.slice(0, Math.max(1, limit - maxTests))) {
    selected.set(component.id, component);
  }

  for (const component of tests.slice(0, maxTests)) {
    selected.set(component.id, component);
  }

  for (const component of ranked) {
    if (selected.size >= limit) {
      break;
    }
    selected.set(component.id, component);
  }

  return [...selected.values()].sort((a, b) => b.importanceScore - a.importanceScore);
};

const formatNodeLabels = (nodes: GraphNode[]) => {
  const labels = unique(nodes.map((node) => node.label)).slice(0, 3);
  const suffix = nodes.length > labels.length ? ` and ${nodes.length - labels.length} more` : "";
  return `${labels.join(", ")}${suffix}`;
};

const uniqueGraphNodes = (nodes: GraphNode[]) => {
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
};

const capitalize = (value: string) => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const withArticle = (phrase: string) => {
  const article = /^(api|external|entry|integration|orchestration|event|adapter)\b/i.test(phrase) ? "an" : "a";
  return `${article} ${phrase}`;
};

const compactLineRange = (items: OrbitDefinition[]) => {
  const starts = items.map((item) => item.startLine).filter((value): value is number => typeof value === "number");
  const ends = items.map((item) => item.endLine).filter((value): value is number => typeof value === "number");

  if (starts.length === 0 || ends.length === 0) {
    return undefined;
  }

  return `Lines ${Math.min(...starts)}-${Math.max(...ends)}`;
};

const tagsForComponent = (type: ArchitectureNodeType, filePath?: string, tokens: string[] = []) => {
  const tags = new Set<string>();
  tags.add(type);

  const isPromptSpecificPath = pathSignalScore(filePath, tokens) >= 25;
  if (
    type === "ui" ||
    type === "controller" ||
    (isPromptSpecificPath && /(^|\/)(index|app|mod|route|router)\./i.test(filePath ?? ""))
  ) {
    tags.add("entrypoint");
  }

  if (filePath?.includes("/")) {
    tags.add("source-code");
  }

  return [...tags];
};

const labelForComponent = (filePath: string | undefined, name: string | undefined, type: ArchitectureNodeType) => {
  if (name && shouldUseDefinitionName(name, type)) {
    return name;
  }

  const path = filePath ?? name ?? "Component";
  const stem = basename(path).replace(/\.[^.]+$/, "");
  if (/^(mod|index|lib)$/.test(stem) && filePath) {
    const parent = basename(dirname(filePath));
    if (stem === "lib" && parent === "src") {
      return basename(dirname(dirname(filePath))) || parent;
    }
    return parent || stem;
  }

  return stem;
};

const shouldUseDefinitionName = (name: string, type: ArchitectureNodeType) => {
  if (type === "test") {
    return false;
  }

  return /[A-Z]/.test(name) || /(service|controller|model|client|page|component|handler|store)$/i.test(name);
};

const matchImportTarget = (item: OrbitImport, components: ComponentRecord[]) => {
  const importText = `${item.importPath ?? ""} ${item.identifierName ?? ""} ${item.identifierAlias ?? ""}`.toLowerCase();
  if (!importText.trim()) {
    return undefined;
  }

  return components.find((component) => {
    const componentText = `${component.label} ${component.filePath ?? ""} ${component.definitionNames.join(" ")}`.toLowerCase();
    return component.definitionNames.some((name) => importText.includes(name.toLowerCase())) ||
      importText.includes(component.label.toLowerCase()) ||
      componentText.includes(importText);
  });
};

const addTestEdges = (edges: Map<string, OrbitDependency>, components: ComponentRecord[]) => {
  const production = components.filter((component) => component.type !== "test");
  const tests = components.filter((component) => component.type === "test");

  for (const test of tests) {
    const normalizedTestName = normalizeForMatch(`${test.label} ${test.filePath ?? ""}`)
      .replace(/\b(test|spec|tests|specs)\b/g, "")
      .trim();

    const target = production.find((component) => {
      const candidate = normalizeForMatch(`${component.label} ${component.filePath ?? ""}`);
      return normalizedTestName.includes(candidate) || candidate.includes(normalizedTestName);
    });

    if (target) {
      addEdge(edges, test.id, target.id, "covers", "test", {
        source: "test-match",
        detail: `Test-like file ${test.label} matched nearby production component ${target.label}.`
      });
    }
  }
};

const addModuleContextEdges = (edges: Map<string, OrbitDependency>, components: ComponentRecord[]) => {
  const byDirectory = new Map<string, ComponentRecord[]>();

  for (const component of components) {
    if (!component.filePath) {
      continue;
    }
    const directory = dirname(component.filePath);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), component]);
  }

  for (const group of byDirectory.values()) {
    if (group.length < 2) {
      continue;
    }

    const anchor = chooseModuleAnchor(group);
    if (!anchor) {
      continue;
    }
    for (const component of group) {
      if (component.id === anchor.id) {
        continue;
      }
      addEdge(edges, anchor.id, component.id, "same module", "ownership", {
        source: "module-context",
        detail: `${anchor.label} and ${component.label} live in the same directory.`
      });
    }
  }

  const production = components.filter((component) => component.type !== "test");
  const tests = components.filter((component) => component.type === "test");
  for (const test of tests) {
    const target = bestProductionMatch(test, production);
    if (target) {
      addEdge(edges, test.id, target.id, "covers nearby feature", "test", {
        source: "test-match",
        detail: `Test-like file ${test.label} shares naming or directory signals with ${target.label}.`
      });
    }
  }

  const highSignal = production.filter((component) => {
    return component.filePath && /(^|\/)(auth|authentication|authorization)(\/|_|-|\.|$)/i.test(component.filePath);
  });
  const authAnchor = chooseModuleAnchor(highSignal);
  if (authAnchor) {
    for (const component of highSignal) {
      if (component.id !== authAnchor.id) {
        addEdge(edges, authAnchor.id, component.id, "auth area", "ownership", {
          source: "module-context",
          detail: `${authAnchor.label} and ${component.label} share authentication path signals.`
        });
      }
    }
  }
};

const chooseModuleAnchor = (components: ComponentRecord[]) => {
  return [...components].sort((a, b) => {
    const aPath = a.filePath ?? "";
    const bPath = b.filePath ?? "";
    const aIsRoot = /(^|\/)(mod|index|lib|app|route|router)\.[a-z0-9]+$/i.test(aPath) ? 1 : 0;
    const bIsRoot = /(^|\/)(mod|index|lib|app|route|router)\.[a-z0-9]+$/i.test(bPath) ? 1 : 0;
    return (bIsRoot - aIsRoot) ||
      (roleWeights[b.type] - roleWeights[a.type]) ||
      (b.importanceScore - a.importanceScore);
  })[0];
};

const bestProductionMatch = (test: ComponentRecord, production: ComponentRecord[]) => {
  const testText = normalizeForMatch(`${test.label} ${test.filePath ?? ""}`);
  let best: { component: ComponentRecord; score: number } | undefined;

  for (const component of production) {
    const componentText = normalizeForMatch(`${component.label} ${component.filePath ?? ""} ${component.definitionNames.join(" ")}`);
    const sharedTerms = testText
      .split(" ")
      .filter((term) => term.length > 2 && !genericTokens.has(term) && componentText.includes(term));
    const sameDirectory = test.filePath && component.filePath && dirname(test.filePath) === dirname(component.filePath) ? 8 : 0;
    const score = sharedTerms.length * 3 + sameDirectory;

    if (score > 0 && (!best || score > best.score)) {
      best = { component, score };
    }
  }

  return best?.component;
};

const applyEdgeMetadata = (components: ComponentRecord[], edges: OrbitDependency[]) => {
  for (const component of components) {
    component.dependencies = edges
      .filter((edge) => edge.source === component.id)
      .map((edge) => edge.target);
    component.relatedTests = edges
      .filter((edge) => edge.target === component.id && edge.type === "test")
      .map((edge) => edge.source);
  }
};

const relationshipEvidenceForComponent = (
  component: ComponentRecord,
  edges: OrbitDependency[],
  byId: Map<string, GraphNode>
) => {
  return edges
    .filter((edge) => edge.source === component.id || edge.target === component.id)
    .slice(0, 8)
    .map((edge) => {
      const source = byId.get(edge.source)?.label ?? edge.source;
      const target = byId.get(edge.target)?.label ?? edge.target;
      return `${source} -> ${target}: ${edge.evidence?.detail ?? edge.label}`;
    });
};

const evidenceForComponent = (
  component: ComponentRecord,
  outgoing: GraphNode[],
  incoming: GraphNode[],
  relatedTests: GraphNode[],
  edges: OrbitDependency[]
): NodeDetails["evidence"] => {
  const relevantEdges = edges.filter((edge) => edge.source === component.id || edge.target === component.id);
  const missing: string[] = [];

  if (relatedTests.length === 0) {
    missing.push("No related tests appeared at this graph depth.");
  }
  if (outgoing.length === 0) {
    missing.push("No outgoing dependency was visible at this graph depth.");
  }
  if (component.definitionNames.length === 0) {
    missing.push("Orbit did not return named definitions for this node.");
  }

  const confidence = relevantEdges.some((edge) => edge.evidence?.source === "orbit-call" || edge.evidence?.source === "orbit-import") &&
    component.definitionNames.length > 0
    ? "high"
    : component.filePath || relevantEdges.length > 0
      ? "medium"
      : "low";

  return {
    sourceFile: component.filePath,
    indexedDefinitionCount: component.definitionNames.length,
    incomingCount: incoming.length,
    outgoingCount: outgoing.length,
    relatedTestCount: relatedTests.length,
    confidence,
    missing
  };
};

const addEdge = (
  edges: Map<string, OrbitDependency>,
  source: string,
  target: string,
  label: string,
  type: GraphEdge["type"],
  evidence?: OrbitDependency["evidence"]
) => {
  const id = `${source}->${target}:${label}`;
  if (!edges.has(id)) {
    edges.set(id, { id, source, target, label, type, evidence });
  }
};

const collapseEdges = (edges: OrbitDependency[]) => {
  const byPair = new Map<string, OrbitDependency & { labels: string[] }>();

  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, { ...edge, id: key, labels: [edge.label] });
      continue;
    }
    existing.labels = unique([...existing.labels, edge.label]);
  }

  return [...byPair.values()].map(({ labels, ...edge }) => ({
    ...edge,
    label: compactEdgeLabel(labels),
    evidence: edge.evidence ?? {
      source: "module-context" as const,
      detail: compactEdgeLabel(labels)
    }
  }));
};

const compactEdgeLabel = (labels: string[]) => {
  const uniqueLabels = unique(labels);
  if (uniqueLabels.length <= 2) {
    return uniqueLabels.join(", ");
  }

  const importLabels = uniqueLabels.filter((label) => label.startsWith("imports "));
  if (importLabels.length === uniqueLabels.length) {
    return `imports ${importLabels.length} symbols`;
  }

  return `${uniqueLabels.slice(0, 2).join(", ")} +${uniqueLabels.length - 2}`;
};

const stripComponentMetadata = (component: ComponentRecord): OrbitSymbol => ({
  id: component.id,
  name: component.label,
  type: component.type,
  filePath: component.filePath,
  summary: component.summary,
  indexedDefinitions: component.definitionNames,
  importanceScore: component.importanceScore,
  dependencies: component.dependencies,
  relatedTests: component.relatedTests,
  tags: component.tags
});

const componentToGraphNode = (component: ComponentRecord): GraphNode => ({
  id: component.id,
  label: component.label,
  type: component.type,
  filePath: component.filePath,
  summary: component.summary,
  indexedDefinitions: component.definitionNames,
  importanceScore: component.importanceScore,
  dependencies: component.dependencies,
  relatedTests: component.relatedTests,
  tags: component.tags
});

const componentId = (filePath: string) => `component:${stableHash(filePath)}`;

const stableHash = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

const basename = (value: string) => value.split("/").filter(Boolean).at(-1) ?? value;

const dirname = (value: string) => {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

const normalizePath = (value: string) => value.replace(/^\/+/, "").toLowerCase();

const normalizeForMatch = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
};

const unique = <T>(values: T[]) => [...new Set(values)];

const stringValue = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const raw = value[key];
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return String(raw);
  }

  return undefined;
};

const numberValue = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const raw = value[key];
  if (typeof raw === "number") {
    return raw;
  }

  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const sanitizeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Orbit error";
  return message.replace(/glpat-[A-Za-z0-9_.-]+/g, "[redacted-token]");
};

const isTransientOrbitStatus = (status: number) => status === 502 || status === 503 || status === 504;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeResponseText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  return text.replace(/glpat-[A-Za-z0-9_.-]+/g, "[redacted-token]").slice(0, 500);
};
