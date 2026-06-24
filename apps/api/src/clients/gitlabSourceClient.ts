type GitLabSourceClientOptions = {
  baseUrl: string;
  token?: string | undefined;
};

export class GitLabSourceClient {
  private readonly baseUrl: string;
  private readonly token?: string | undefined;
  private readonly cache = new Map<string, string>();

  constructor(options: GitLabSourceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
  }

  async getRawFile(repoUrl: string, filePath: string, ref = "HEAD") {
    const projectPath = parseProjectPath(repoUrl);
    if (!projectPath) {
      throw new Error(`GitLab source fetch failed: could not parse project path from repo URL "${repoUrl}".`);
    }

    const cacheKey = `${projectPath}:${ref}:${filePath}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`;
    const headers: Record<string, string> = {
      Accept: "text/plain"
    };

    if (this.token) {
      headers["PRIVATE-TOKEN"] = this.token;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitLab source fetch failed for ${filePath}: ${response.status} ${await safeResponseText(response)}`);
    }

    const source = await response.text();
    this.cache.set(cacheKey, source);
    return source;
  }
}

const parseProjectPath = (repoUrl: string) => {
  const trimmed = repoUrl.trim().replace(/\.git$/, "");

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.replace(/^\/+|\/+$/g, "") || undefined;
  } catch {
    return trimmed.includes("/") ? trimmed.replace(/^\/+|\/+$/g, "") : undefined;
  }
};

const safeResponseText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  return text.slice(0, 500) || response.statusText;
};
