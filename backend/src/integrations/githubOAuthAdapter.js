const requestTimeoutMs = 8_000;
const githubApiVersion = "2022-11-28";

export class GitHubOAuthError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = "GitHubOAuthError";
    this.status = status;
  }
}

export function createGitHubOAuthAdapter({ env = process.env, timeoutMs = requestTimeoutMs, endpoints } = {}) {
  function createAuthorizationUrl(state) {
    if (typeof state !== "string" || !state.trim() || state.length > 256) {
      throw new GitHubOAuthError("GitHub-inloggningen kunde inte startas. Försök igen.", { status: 400 });
    }

    const config = readConfig(env);
    const authorizeUrl = new URL(endpoints?.authorization ?? "https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("scope", "read:user");
    authorizeUrl.searchParams.set("state", state);
    return authorizeUrl.toString();
  }

  async function exchangeCode(code) {
    if (typeof code !== "string" || !code.trim() || code.length > 2048) {
      throw new GitHubOAuthError("GitHub returnerade en ogiltig inloggning.", { status: 400 });
    }

    const config = readConfig(env);
    try {
      const tokenResponse = await fetch(endpoints?.token ?? "https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const tokenPayload = await readJson(tokenResponse);
      if (!tokenResponse.ok || typeof tokenPayload?.access_token !== "string" || !tokenPayload.access_token.trim()) {
        throw new Error("GitHub token exchange failed.");
      }

      const userResponse = await fetch(endpoints?.user ?? "https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenPayload.access_token}`,
          "X-GitHub-Api-Version": githubApiVersion,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const profile = await readJson(userResponse);
      if (!userResponse.ok) throw new Error("GitHub profile request failed.");
      return validateProfile(profile);
    } catch (error) {
      if (error instanceof GitHubOAuthError) throw error;
      throw new GitHubOAuthError("GitHub kunde inte verifiera inloggningen. Försök igen.");
    }
  }

  return { createAuthorizationUrl, exchangeCode };
}

function readConfig(env) {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GitHubOAuthError("GitHub-inloggning är inte konfigurerad.", { status: 503 });
  }

  let callback;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new GitHubOAuthError("GitHub-inloggning är inte korrekt konfigurerad.", { status: 503 });
  }

  const isLocalHttp = callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!isLocalHttp && callback.protocol !== "https:") ||
      callback.pathname !== "/api/auth/github/callback" || callback.search || callback.hash ||
      callback.username || callback.password) {
    throw new GitHubOAuthError("GitHub-inloggning är inte korrekt konfigurerad.", { status: 503 });
  }

  return { clientId, clientSecret, redirectUri };
}

async function readJson(response) {
  try {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON response.");
    return value;
  } catch {
    throw new Error("Invalid GitHub response.");
  }
}

function validateProfile(profile) {
  const id = typeof profile?.id === "number" && Number.isSafeInteger(profile.id) && profile.id > 0
    ? String(profile.id)
    : "";
  const login = typeof profile?.login === "string" ? profile.login.trim() : "";
  const name = typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : login;

  if (!id || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login) || name.length > 200) {
    throw new GitHubOAuthError("GitHub returnerade en ogiltig användarprofil.");
  }

  return { id, login, name };
}
