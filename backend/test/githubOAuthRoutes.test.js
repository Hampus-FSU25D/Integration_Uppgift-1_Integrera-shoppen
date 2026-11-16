import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createGitHubOAuthRouter } from "../src/integrations/githubOAuthRoutes.js";

function createDependencies({ identity = { id: "12345", login: "HampusAndersson01", name: "Hampus Andersson" } } = {}) {
  const queries = [];
  const session = {};
  const logs = [];
  let sessionStarts = 0;
  const database = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [{ github_id: values[0], login: values[1], name: values[2] }] };
    },
  };
  const adapter = {
    createAuthorizationUrl(state) { return `https://github.com/login/oauth/authorize?state=${state}`; },
    async exchangeCode(code) {
      assert.equal(code, "valid-code");
      return identity;
    },
  };
  const startSession = async (_request, admin) => {
    sessionStarts += 1;
    session.githubAdminId = admin.id;
    session.githubAdminLogin = admin.login;
  };
  const logger = {
    warn(...args) { logs.push(args); },
    error(...args) { logs.push(args); },
  };
  return { adapter, database, logger, logs, queries, session, startSession, get sessionStarts() { return sessionStarts; } };
}

async function request(path, dependencies) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = dependencies.session;
    next();
  });
  app.use("/api/auth/github", createGitHubOAuthRouter({
    ...dependencies,
    frontendUrl: "http://localhost:8080",
    allowedLogins: "HampusAndersson01, sibala",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: "manual" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("starts GitHub login with a random state stored in the session", async () => {
  const dependencies = createDependencies();
  const response = await request("/api/auth/github", dependencies);
  const redirect = new URL(response.headers.get("location"));

  assert.equal(response.status, 302);
  assert.equal(redirect.origin, "https://github.com");
  assert.equal(dependencies.session.githubAuthState, redirect.searchParams.get("state"));
  assert.ok(dependencies.session.githubAuthState.length >= 32);
});

test("rejects a missing or mismatched state without exchanging the code", async () => {
  const dependencies = createDependencies();
  dependencies.session.githubAuthState = "expected-state";
  const response = await request("/api/auth/github/callback?code=valid-code&state=wrong", dependencies);

  assert.match(response.headers.get("location"), /github_login=failed/);
  assert.equal(dependencies.queries.length, 0);
  assert.equal(dependencies.session.githubAuthState, undefined);
  assert.equal(dependencies.sessionStarts, 0);
});

test("creates a session and stores the stable GitHub ID for an allowed login", async () => {
  const dependencies = createDependencies();
  dependencies.session.githubAuthState = "expected-state";
  const response = await request("/api/auth/github/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).pathname, "/admin");
  assert.match(response.headers.get("location"), /github_login=success/);
  assert.equal(dependencies.session.githubAdminId, "12345");
  assert.equal(dependencies.sessionStarts, 1);
  assert.match(dependencies.queries[0].sql, /github_id/);
  assert.deepEqual(dependencies.queries[0].values, ["12345", "HampusAndersson01", "Hampus Andersson"]);
});

test("accepts another login from the comma-separated admin allowlist", async () => {
  const dependencies = createDependencies({ identity: { id: "54321", login: "sibala", name: "Sibala" } });
  dependencies.session.githubAuthState = "expected-state";
  const response = await request("/api/auth/github/callback?code=valid-code&state=expected-state", dependencies);

  assert.match(response.headers.get("location"), /github_login=success/);
  assert.equal(dependencies.session.githubAdminId, "54321");
  assert.equal(dependencies.queries.length, 1);
});

test("rejects a GitHub login that is not in the allowlist without storing it", async () => {
  const dependencies = createDependencies({ identity: { id: "888", login: "not-an-admin", name: "Visitor" } });
  dependencies.session.githubAuthState = "expected-state";
  const response = await request("/api/auth/github/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(new URL(response.headers.get("location")).pathname, "/admin/login");
  assert.match(response.headers.get("location"), /github_login=forbidden/);
  assert.equal(dependencies.queries.length, 0);
  assert.equal(dependencies.sessionStarts, 0);
});

test("returns a clear result when the user cancels GitHub authorization", async () => {
  const dependencies = createDependencies();
  dependencies.session.githubAuthState = "expected-state";
  const response = await request("/api/auth/github/callback?error=access_denied&state=expected-state", dependencies);

  assert.equal(new URL(response.headers.get("location")).pathname, "/admin/login");
  assert.match(response.headers.get("location"), /github_login=cancelled/);
  assert.equal(dependencies.queries.length, 0);
  assert.equal(dependencies.sessionStarts, 0);
});
