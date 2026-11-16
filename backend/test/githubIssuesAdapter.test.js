import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubIssuesAdapter, GitHubIssuesError } from "../src/integrations/githubIssuesAdapter.js";

const config = { token: "test-token", owner: "shop-owner", repository: "shop-repo" };

test("lists open repository issues and excludes pull requests", async () => {
  let requestUrl;
  const adapter = createGitHubIssuesAdapter({
    ...config,
    fetchImpl: async (url) => {
      requestUrl = url;
      return jsonResponse([
        { number: 8, title: "Bug", body: "Details", html_url: "https://github.com/shop-owner/shop-repo/issues/8", user: { login: "reporter" } },
        { number: 9, title: "Pull request", body: null, html_url: "https://github.com/shop-owner/shop-repo/pull/9", user: { login: "contributor" }, pull_request: {} },
      ]);
    },
  });

  const issues = await adapter.listOpenIssues();

  assert.equal(requestUrl, "https://api.github.com/repos/shop-owner/shop-repo/issues?state=open&per_page=100");
  assert.deepEqual(issues, [{
    number: 8,
    title: "Bug",
    body: "Details",
    url: "https://github.com/shop-owner/shop-repo/issues/8",
    author: "reporter",
  }]);
});

test("creates a repository issue with the title and author-tagged body", async () => {
  let request;
  const adapter = createGitHubIssuesAdapter({
    ...config,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        number: 12,
        title: "Checkout error",
        body: "Checkout fails.\n\nReported by @admin-user.",
        html_url: "https://github.com/shop-owner/shop-repo/issues/12",
      }, 201);
    },
  });

  const issue = await adapter.createIssue({ title: "Checkout error", description: "Checkout fails.", reportedBy: "admin-user" });

  assert.equal(request.url, "https://api.github.com/repos/shop-owner/shop-repo/issues");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), {
    title: "Checkout error",
    body: "Checkout fails.\n\nReported by @admin-user.",
  });
  assert.deepEqual(issue, {
    number: 12,
    title: "Checkout error",
    body: "Checkout fails.\n\nReported by @admin-user.",
    url: "https://github.com/shop-owner/shop-repo/issues/12",
  });
});

test("times out a GitHub request and returns a safe error", async () => {
  let timedOut = false;
  const adapter = createGitHubIssuesAdapter({
    ...config,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        timedOut = true;
        reject(signal.reason);
      }, { once: true });
    }),
  });

  await assert.rejects(adapter.listOpenIssues(), GitHubIssuesError);
  assert.equal(timedOut, true);
});

test("returns a safe integration error when GitHub rejects the request", async () => {
  const adapter = createGitHubIssuesAdapter({
    ...config,
    fetchImpl: async () => jsonResponse({ message: "Bad credentials" }, 401),
  });

  await assert.rejects(adapter.listOpenIssues(), (error) => {
    assert.ok(error instanceof GitHubIssuesError);
    assert.match(error.message, /GitHub/i);
    assert.doesNotMatch(error.message, /Bad credentials|test-token/);
    return true;
  });
});

test("rejects malformed issue responses", async () => {
  const adapter = createGitHubIssuesAdapter({
    ...config,
    fetchImpl: async () => jsonResponse([{ number: "wrong", title: "Broken" }]),
  });

  await assert.rejects(adapter.listOpenIssues(), GitHubIssuesError);
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
