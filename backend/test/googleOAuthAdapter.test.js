import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { createGoogleOAuthAdapter, GoogleOAuthError } from "../src/integrations/googleOAuthAdapter.js";

const clientId = "test-google-client.apps.googleusercontent.com";
const clientSecret = "test-google-client-secret";
const redirectUri = "http://localhost:5173/api/auth/google/callback";
const env = { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri };
const requestTimeoutMs = 1_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

test("builds a Google authorization URL with only identity scopes and the supplied state", () => {
  const adapter = createGoogleOAuthAdapter({ env });
  const state = "a".repeat(64);
  const authorizeUrl = new URL(adapter.createAuthorizationUrl(state));

  assert.equal(authorizeUrl.origin, "https://accounts.google.com");
  assert.equal(authorizeUrl.searchParams.get("client_id"), clientId);
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
  assert.deepEqual(authorizeUrl.searchParams.get("scope")?.split(" ").sort(), ["email", "openid", "profile"]);
  assert.equal(authorizeUrl.searchParams.get("state"), state);
  assert.equal(authorizeUrl.searchParams.has("access_type"), false);
});

test("exchanges the code and returns only verified identity claims", async () => {
  const idToken = signIdToken({
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: "google-customer-123",
    email: "Customer@Example.com",
    email_verified: true,
    name: "Google Customer",
  });
  const mock = await startGoogleMock({ idToken });

  try {
    const adapter = createGoogleOAuthAdapter({
      env,
      oauthClient: createTestOAuthClient(mock),
    });
    const identity = await adapter.exchangeCode("test-authorization-code");

    assert.deepEqual(identity, {
      sub: "google-customer-123",
      email: "customer@example.com",
      name: "Google Customer",
    });
    assert.equal(mock.tokenRequest.code, "test-authorization-code");
    assert.equal(mock.tokenRequest.grant_type, "authorization_code");
    assert.equal(mock.tokenRequest.redirect_uri, redirectUri);
    assert.equal(mock.tokenRequest.client_secret, clientSecret);
    assert.equal(JSON.stringify(identity).includes(idToken), false);
    assert.equal(JSON.stringify(identity).includes("test-access-token"), false);
  } finally {
    await mock.close();
  }
});

test("rejects invalid ID token signature, audience, issuer, expiry, and claims", async () => {
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const invalidTokens = [
    signIdToken({ ...validClaims(), aud: "another-app" }),
    signIdToken({ ...validClaims(), iss: "https://attacker.example" }),
    signIdToken({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 60 }),
    signIdToken({ ...validClaims(), email_verified: false }),
    signIdToken({ ...validClaims(), sub: " " }),
    signIdToken(validClaims(), otherKey),
  ];

  for (const idToken of invalidTokens) {
    const mock = await startGoogleMock({ idToken });
    try {
      const adapter = createGoogleOAuthAdapter({ env, oauthClient: createTestOAuthClient(mock) });
      await assert.rejects(adapter.exchangeCode("test-authorization-code"), GoogleOAuthError);
    } finally {
      await mock.close();
    }
  }
});

test("maps provider failures, missing tokens, and request timeouts to controlled errors", async () => {
  const failedProvider = await startGoogleMock({ tokenStatus: 503 });
  try {
    const adapter = createGoogleOAuthAdapter({ env, oauthClient: createTestOAuthClient(failedProvider) });
    await assert.rejects(adapter.exchangeCode("test-authorization-code"), (error) =>
      error instanceof GoogleOAuthError && error.status === 502 && !error.message.includes(clientSecret));
    assert.equal(failedProvider.tokenRequests, 1);
  } finally {
    await failedProvider.close();
  }

  const malformedProvider = await startGoogleMock({ tokenResponse: { access_token: "test-access-token" } });
  try {
    const adapter = createGoogleOAuthAdapter({ env, oauthClient: createTestOAuthClient(malformedProvider) });
    await assert.rejects(adapter.exchangeCode("test-authorization-code"), GoogleOAuthError);
  } finally {
    await malformedProvider.close();
  }

  const slowProvider = await startGoogleMock({ tokenDelayMs: 150 });
  try {
    const adapter = createGoogleOAuthAdapter({
      env,
      timeoutMs: 30,
      oauthClient: createTestOAuthClient(slowProvider, 30),
    });
    await assert.rejects(adapter.exchangeCode("test-authorization-code"), GoogleOAuthError);
  } finally {
    await slowProvider.close();
  }

  const slowCertificates = await startGoogleMock({ idToken: signIdToken(validClaims()), certDelayMs: 150 });
  try {
    const adapter = createGoogleOAuthAdapter({
      env,
      timeoutMs: 30,
      oauthClient: createTestOAuthClient(slowCertificates, 30),
    });
    await assert.rejects(adapter.exchangeCode("test-authorization-code"), GoogleOAuthError);
  } finally {
    await slowCertificates.close();
  }
});

function createTestOAuthClient(mock, timeoutMs = requestTimeoutMs) {
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    transporterOptions: { timeout: timeoutMs, retry: false },
    endpoints: {
      oauth2TokenUrl: mock.tokenUrl,
      oauth2FederatedSignonPemCertsUrl: mock.certsUrl,
    },
  });
}

function validClaims() {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: now + 3600,
    iat: now,
    sub: "google-customer-123",
    email: "customer@example.com",
    email_verified: true,
    name: "Google Customer",
  };
}

function signIdToken(claims, key = privateKey) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsignedToken = `${encode({ alg: "RS256", kid: "lab6-test-key", typ: "JWT" })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsignedToken).end().sign(key).toString("base64url");
  return `${unsignedToken}.${signature}`;
}

async function startGoogleMock({ idToken, tokenResponse, tokenStatus = 200, tokenDelayMs = 0, certDelayMs = 0 } = {}) {
  const state = { tokenRequest: null, tokenRequests: 0 };
  const server = createServer(async (request, response) => {
    if (request.url === "/token" && request.method === "POST") {
      state.tokenRequests += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      state.tokenRequest = Object.fromEntries(new URLSearchParams(body));
      if (tokenDelayMs) await new Promise((resolve) => setTimeout(resolve, tokenDelayMs));
      response.writeHead(tokenStatus, { "content-type": "application/json" });
      response.end(JSON.stringify(tokenResponse ?? { id_token: idToken, access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 }));
      return;
    }
    if (request.url === "/certs" && request.method === "GET") {
      if (certDelayMs) await new Promise((resolve) => setTimeout(resolve, certDelayMs));
      response.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=60" });
      response.end(JSON.stringify({ "lab6-test-key": publicKeyPem }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    ...state,
    get tokenRequest() { return state.tokenRequest; },
    get tokenRequests() { return state.tokenRequests; },
    tokenUrl: `http://127.0.0.1:${address.port}/token`,
    certsUrl: `http://127.0.0.1:${address.port}/certs`,
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
