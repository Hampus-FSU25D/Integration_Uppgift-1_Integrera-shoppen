import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createGitHubIssuesRouter } from "../src/integrations/githubIssuesRoutes.js";

test("lists repository issues for an authenticated administrator", async () => {
  const issues = [{ number: 4, title: "Images fail", url: "https://github.com/shop/repo/issues/4" }];
  const response = await requestIssues("GET", { adapter: { async listOpenIssues() { return issues; } } });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), issues);
});

test("requires an admin session to list issues", async () => {
  const response = await requestIssues("GET", { authenticated: false });

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /login/i);
});

test("requires an admin session to create an issue", async () => {
  const response = await requestIssues("POST", { authenticated: false, body: { title: "Bug", description: "Details" } });

  assert.equal(response.status, 401);
});

test("rejects a signed-in customer from the issues routes", async () => {
  const response = await requestIssues("GET", { admin: false });

  assert.equal(response.status, 403);
});

test("creates an issue and attributes it to the GitHub admin in the session", async () => {
  let received;
  const created = { number: 5, title: "Checkout fails", url: "https://github.com/shop/repo/issues/5" };
  const response = await requestIssues("POST", {
    body: { title: "  Checkout fails  ", description: "  Payment did not complete.  " },
    adapter: { async createIssue(input) { received = input; return created; } },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    title: "Checkout fails",
    description: "Payment did not complete.",
    reportedBy: "approved-admin",
  });
  assert.deepEqual(await response.json(), created);
});

test("rejects missing or oversized issue fields", async () => {
  const missing = await requestIssues("POST", { body: { title: " ", description: "Details" } });
  const oversized = await requestIssues("POST", { body: { title: "x".repeat(257), description: "Details" } });

  assert.equal(missing.status, 400);
  assert.equal(oversized.status, 400);
});

test("requires a GitHub admin identity when creating an issue", async () => {
  const response = await requestIssues("POST", {
    githubLogin: null,
    body: { title: "Bug", description: "Details" },
  });

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /GitHub/i);
});

test("returns a safe error when the GitHub issues service fails", async () => {
  const response = await requestIssues("GET", {
    adapter: { async listOpenIssues() { throw new Error("internal token details"); } },
  });

  assert.equal(response.status, 502);
  const result = await response.json();
  assert.match(result.error, /GitHub/i);
  assert.doesNotMatch(JSON.stringify(result), /token/i);
});

async function requestIssues(method, {
  adapter = { async listOpenIssues() { return []; }, async createIssue() { return {}; } },
  authenticated = true,
  admin = true,
  githubLogin = "approved-admin",
  body,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = authenticated ? { githubAdminLogin: githubLogin } : {};
    next();
  });
  app.use("/api/admin/github/issues", createGitHubIssuesRouter({
    adapter,
    requireAdmin(request, response, next) {
      if (!authenticated) return response.status(401).json({ error: "Login required." });
      if (!admin) return response.status(403).json({ error: "Admin access required." });
      return next();
    },
  }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/admin/github/issues`, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
