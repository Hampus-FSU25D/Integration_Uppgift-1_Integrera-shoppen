import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createGoogleOAuthRouter } from "../src/integrations/googleOAuthRoutes.js";

const existing = { id: "user-1", email: "customer@example.com", role: "customer", google_sub: null };

function createDependencies({ identity = { sub: "google-123", email: "customer@example.com", name: "Customer" }, existingUser = null } = {}) {
  const calls = [];
  const session = {};
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("where google_sub")) return { rows: [] };
      if (sql.includes("where email")) return { rows: existingUser ? [{ ...existingUser }] : [] };
      if (sql.includes("update users set google_sub")) return { rows: [{ id: existingUser.id, email: existingUser.email, role: existingUser.role }] };
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

  return { calls, database, session, adapter, startSession };
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

test("links the verified Google identity to an existing matching email and starts a session", async () => {
  const dependencies = createDependencies({ existingUser: existing });
  dependencies.session.googleAuthState = "expected-state";
  const response = await request("/api/auth/google/callback?code=valid-code&state=expected-state", dependencies);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /google_login=success/);
  assert.equal(dependencies.session.userId, "user-1");
  assert.ok(dependencies.calls.some(({ sql, values }) => sql.includes("update users set google_sub") && values[0] === "google-123"));
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
