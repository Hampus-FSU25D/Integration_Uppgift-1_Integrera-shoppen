const API_URL = "https://api.github.com";

export class GitHubIssuesError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "GitHubIssuesError";
    this.status = status;
  }
}

export function createGitHubIssuesAdapter({
  token = process.env.GITHUB_ISSUES_TOKEN,
  owner = process.env.GITHUB_REPOSITORY_OWNER,
  repository = process.env.GITHUB_REPOSITORY_NAME,
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  async function request(path, options = {}) {
    if (!token || !owner || !repository || !isRepositoryPart(owner) || !isRepositoryPart(repository)) {
      throw new GitHubIssuesError("GitHub Issues is not configured on the server.", 503);
    }

    let response;
    try {
      response = await fetchImpl(`${API_URL}/repos/${owner}/${repository}/issues${path}`, {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "EverydayMarketShop",
          ...(options.method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GitHubIssuesError("GitHub is temporarily unavailable. Try again.");
    }

    if (!response.ok) {
      throw new GitHubIssuesError("GitHub rejected the issue request. Check the Issues token and repository settings.");
    }

    try {
      return await response.json();
    } catch {
      throw new GitHubIssuesError("GitHub returned an unreadable response.");
    }
  }

  return {
    // https://docs.github.com/en/rest/issues/issues#list-repository-issues
    async listOpenIssues() {
      const data = await request("?state=open&per_page=100");
      if (!Array.isArray(data)) throw new GitHubIssuesError("GitHub returned an invalid issues list.");
      return data.filter((issue) => !issue?.pull_request).map((issue) => toPublicIssue(issue));
    },

    // https://docs.github.com/en/rest/issues/issues#create-an-issue
    async createIssue({ title, description, reportedBy }) {
      const body = `${description}\n\nReported by @${reportedBy}.`;
      const issue = await request("", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      });
      return toPublicIssue(issue, { includeAuthor: false });
    },
  };
}

function toPublicIssue(issue, { includeAuthor = true } = {}) {
  const url = typeof issue?.html_url === "string" ? parseGitHubUrl(issue.html_url) : null;
  if (!Number.isSafeInteger(issue?.number) || issue.number < 1 || typeof issue.title !== "string" || !issue.title.trim() || !url) {
    throw new GitHubIssuesError("GitHub returned an invalid issue.");
  }

  const body = typeof issue.body === "string" ? issue.body : issue.body === null || issue.body === undefined ? "" : null;
  const author = issue.user?.login;
  if (body === null || (includeAuthor && (typeof author !== "string" || !author))) {
    throw new GitHubIssuesError("GitHub returned an invalid issue.");
  }

  return {
    number: issue.number,
    title: issue.title,
    body,
    url: url.toString(),
    ...(includeAuthor ? { author } : {}),
  };
}

function parseGitHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url : null;
  } catch {
    return null;
  }
}

function isRepositoryPart(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value);
}
