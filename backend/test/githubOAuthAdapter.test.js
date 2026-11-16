import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createGitHubOAuthAdapter, GitHubOAuthError } from "../src/integrations/githubOAuthAdapter.js";

const clientId = "test-github-client";
const clientSecret = "test-github-secret";
const redirectUri = "http://localhost:8080/api/auth/github/callback";
const env = { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret, GITHUB_REDIRECT_URI: redirectUri };

test("creates a GitHub authorization URL with read:user and the supplied state", () => {
  const adapter = createGitHubOAuthAdapter({ env });
  const authorizeUrl = new URL(adapter.createAuthorizationUrl("state-value"));

  assert.equal(authorizeUrl.origin, "https://github.com");
  assert.equal(authorizeUrl.pathname, "/login/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.get("client_id"), clientId);
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(authorizeUrl.searchParams.get("scope"), "read:user");
  assert.equal(authorizeUrl.searchParams.get("state"), "state-value");
});

test("exchanges a code and returns a validated GitHub identity without the access token", async () => {
  const mock = await startGitHubMock();
  try {
    const adapter = createGitHubOAuthAdapter({ env, endpoints: mock.endpoints });
    const identity = await adapter.exchangeCode("valid-code");

    assert.deepEqual(identity, { id: "12345", login: "HampusAndersson01", name: "Hampus Andersson" });
    assert.equal(mock.state.tokenBody.client_id, clientId);
    assert.equal(mock.state.tokenBody.client_secret, clientSecret);
    assert.equal(mock.state.tokenBody.code, "valid-code");
    assert.equal(mock.state.profileAuthorization, "Bearer test-access-token");
    assert.equal(JSON.stringify(identity).includes("test-access-token"), false);
  } finally {
    await mock.close();
  }
});

test("maps invalid provider responses to a controlled error", async () => {
  const mock = await startGitHubMock({ profile: { id: 12345, login: "bad/login", name: null } });
  try {
    const adapter = createGitHubOAuthAdapter({ env, endpoints: mock.endpoints });
    await assert.rejects(adapter.exchangeCode("valid-code"), GitHubOAuthError);
  } finally {
    await mock.close();
  }
});

test("requires a registered secure callback outside localhost", () => {
  const adapter = createGitHubOAuthAdapter({
    env: { ...env, GITHUB_REDIRECT_URI: "http://shop.example.com/api/auth/github/callback" },
  });
  assert.throws(() => adapter.createAuthorizationUrl("state-value"), GitHubOAuthError);
});

async function startGitHubMock({ profile = { id: 12345, login: "HampusAndersson01", name: "Hampus Andersson" } } = {}) {
  const state = { tokenBody: null, profileAuthorization: null };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;

    if (request.url === "/login/oauth/access_token" && request.method === "POST") {
      state.tokenBody = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: "test-access-token", token_type: "bearer" }));
      return;
    }
    if (request.url === "/user" && request.method === "GET") {
      state.profileAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(profile));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    state,
    endpoints: {
      authorization: `http://127.0.0.1:${address.port}/login/oauth/authorize`,
      token: `http://127.0.0.1:${address.port}/login/oauth/access_token`,
      user: `http://127.0.0.1:${address.port}/user`,
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
