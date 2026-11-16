import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";

export function createGoogleOAuthRouter({ adapter, database, startSession, frontendUrl, logger = console }) {
  const router = express.Router();
  const returnUrl = new URL("/", frontendUrl.split(",")[0].trim());

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/", (request, response) => {
    const state = randomBytes(32).toString("base64url");
    try {
      const authorizationUrl = adapter.createAuthorizationUrl(state);
      delete request.session.pendingGoogleLink;
      request.session.googleAuthState = state;
      return response.redirect(authorizationUrl);
    } catch (error) {
      logFailure(logger, "authorization_start", error);
      return response.redirect(loginResult(returnUrl, "failed"));
    }
  });

  router.get("/callback", async (request, response) => {
    const expectedState = request.session.googleAuthState;
    delete request.session.googleAuthState;

    if (typeof expectedState !== "string" || !matchesState(expectedState, request.query.state)) {
      logger.warn("[google-oauth] callback rejected: state mismatch");
      return response.redirect(loginResult(returnUrl, "failed"));
    }
    if (request.query.error === "access_denied") {
      delete request.session.pendingGoogleLink;
      return response.redirect(loginResult(returnUrl, "cancelled"));
    }
    if (typeof request.query.code !== "string" || request.query.error) {
      return response.redirect(loginResult(returnUrl, "failed"));
    }

    let stage = "token_exchange";
    try {
      const identity = await adapter.exchangeCode(request.query.code);
      stage = "customer_account";
      const result = await findOrCreateCustomer(database, identity);
      if (result.pendingGoogleLink) {
        request.session.pendingGoogleLink = {
          sub: identity.sub,
          email: identity.email,
          name: identity.name,
          requestedAt: Date.now(),
        };
        return response.redirect(loginResult(returnUrl, "link_required"));
      }
      const user = result.user;
      if (!user) return response.redirect(loginResult(returnUrl, "conflict"));
      stage = "session_creation";
      await startSession(request, user);
      return response.redirect(loginResult(returnUrl, "success"));
    } catch (error) {
      logFailure(logger, stage, error);
      return response.redirect(loginResult(returnUrl, "failed"));
    }
  });

  return router;
}

function logFailure(logger, stage, error) {
  const details = { stage, name: typeof error?.name === "string" ? error.name : "Error" };
  const status = Number.isInteger(error?.status) ? error.status : error?.response?.status;
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : undefined;
  if (Number.isInteger(status)) details.status = status;
  if (code) details.code = code;
  logger.error("[google-oauth] sign-in step failed", details);
}

async function findOrCreateCustomer(database, identity) {
  const byGoogleId = await database.query(
    "select id, email, role from users where google_sub = $1",
    [identity.sub],
  );
  if (byGoogleId.rows[0]) return { user: byGoogleId.rows[0] };

  const byEmail = await database.query(
    "select id, email, role, google_sub, password_hash from users where email = $1",
    [identity.email],
  );
  const existing = byEmail.rows[0];
  if (existing) {
    return {
      pendingGoogleLink: existing.role === "customer" && Boolean(existing.password_hash) && !existing.google_sub,
    };
  }

  const created = await database.query(
    "insert into users (email, name, google_sub, role) values ($1, $2, $3, 'customer') returning id, email, role",
    [identity.email, identity.name, identity.sub],
  );
  return { user: created.rows[0] ?? null };
}

function matchesState(expected, actual) {
  if (typeof actual !== "string" || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function loginResult(frontendUrl, result) {
  const url = new URL(frontendUrl);
  url.pathname = result === "success" ? "/" : "/login";
  url.searchParams.set("google_login", result);
  return url.toString();
}
