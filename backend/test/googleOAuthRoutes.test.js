import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createGoogleOAuthRouter } from "../src/integrations/googleOAuthRoutes.js";

const existing = { id: "user-1", email: "customer@example.com", role: "customer", google_sub: null };

function createDependencies({
  identity = { sub: "google-123", email: "customer@example.com", name: "Customer" },
  existingUser = null,
  googleUser = null,
} = {}) {
  const calls = [];
  const logs = [];
  const session = {};
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("where google_sub")) return { rows: googleUser ? [{ ...googleUser }] : [] };
      if (sql.includes("where email")) return { rows: existingUser ? [{ ...existingUser }] : [] };
      if (sql.includes("insert into users")) return { rows: [{ id: "new-user", email: values[0], role: "customer" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const adapter = {
    createAuthorizationUrl(state) { return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`; },
    async exchangeCode(code) {
      assert.equal(code, "valid-code");
      return identity;
    },
  };
  const startSession = async (_request, user) => {
    session.userId = user.id;
  };
  const logger = {
    warn(...args) { logs.push(args); },
    error(...args) { logs.push(args); },
  };

  return { calls, logs, database, session, adapter, startSession, logger };
}

async function request(path, dependencies, method = "GET", cookie) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = dependencies.session;
    next();
  });
  app.use("/api/auth/google", createGoogleOAuthRouter({
    adapter: dependencies.adapter,
    database: dependencies.database,
    startSession: dependencies.startSession,
    frontendUrl: "http://localhost:5173",
    logger: dependencies.logger,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("starts Google login with a random state stored in the session", async () => {
  const dependencies = createDependencies();
  const response = await request("/api/auth/google", dependencies);
  const redirect = new URL(response.headers.get("location"));

  assert.equal(response.status, 302);
  assert.equal(redirect.origin, "https://accounts.google.com");
  assert.equal(dependencies.session.googleAuthState, redirect.searchParams.get("state"));
  assert.ok(dependencies.session.googleAuthState.length >= 32);
});

test("rejects a missing or mismatched state without exchanging the code", async () => {
  const dependencies = createDependencies();
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=wrong-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=failed/);
  assert.equal(dependencies.calls.length, 0);
  assert.equal(dependencies.session.googleAuthState, undefined);
});

test("shows an account conflict for an existing email instead of linking accounts", async () => {
  const dependencies = createDependencies({ existingUser: existing });
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=conflict/);
  assert.equal(dependencies.session.userId, undefined);
  assert.ok(!dependencies.calls.some(({ sql }) => sql.includes("update users set google_sub")));
});

test("reuses an account with the same Google subject", async () => {
  const dependencies = createDependencies({ googleUser: { id: "user-1", email: "customer@example.com", role: "customer" } });
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=success/);
  assert.equal(dependencies.session.userId, "user-1");
  assert.equal(dependencies.calls.length, 1);
});

test("creates a customer identity when no account has the verified email", async () => {
  const dependencies = createDependencies({ identity: { sub: "google-456", email: "new@example.com", name: "New Customer" } });
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.equal(dependencies.session.userId, "new-user");
  assert.ok(dependencies.calls.some(({ sql }) => sql.includes("insert into users")));
});

test("returns an understandable cancellation result", async () => {
  const dependencies = createDependencies();
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?error=access_denied&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=cancelled/);
  assert.equal(dependencies.calls.length, 0);
});

test("logs only a safe failure stage, not the provider error message", async () => {
  const dependencies = createDependencies();
  dependencies.adapter.exchangeCode = async () => {
    throw Object.assign(new Error("secret authorization code"), { code: "ECONNRESET" });
  };
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=failed/);
  assert.deepEqual(dependencies.logs, [["[google-oauth] sign-in step failed", {
    stage: "token_exchange",
    name: "Error",
    code: "ECONNRESET",
  }]]);
  assert.equal(JSON.stringify(dependencies.logs).includes("secret authorization code"), false);
});
