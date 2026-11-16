import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";

export function createGitHubOAuthRouter({
  adapter,
  database,
  startSession,
  frontendUrl,
  allowedLogins = process.env.ADMIN_GITHUB_LOGINS,
  logger = console,
}) {
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
      request.session.githubAuthState = state;
      return response.redirect(authorizationUrl);
    } catch (error) {
      logFailure(logger, "authorization_start", error);
      return response.redirect(loginResult(returnUrl, "failed"));
    }
  });

  router.get("/callback", async (request, response) => {
    const expectedState = request.session.githubAuthState;
    delete request.session.githubAuthState;

    if (!matchesState(expectedState, request.query.state)) {
      logger.warn("[github-oauth] callback rejected: state mismatch");
      return response.redirect(loginResult(returnUrl, "failed"));
    }
    if (request.query.error === "access_denied") {
      return response.redirect(loginResult(returnUrl, "cancelled"));
    }
    if (typeof request.query.code !== "string" || request.query.error) {
      return response.redirect(loginResult(returnUrl, "failed"));
    }

    let stage = "token_exchange";
    try {
      const identity = await adapter.exchangeCode(request.query.code);
      if (!isAllowedLogin(identity.login, allowedLogins)) {
        return response.redirect(loginResult(returnUrl, "forbidden"));
      }

      stage = "admin_identity";
      const result = await database.query(
        `insert into github_admins (github_id, login, name)
         values ($1, $2, $3)
         on conflict (github_id) do update
         set login = excluded.login, name = excluded.name, updated_at = now()
         returning github_id, login, name`,
        [identity.id, identity.login, identity.name],
      );
      const admin = result.rows[0];
      if (!admin) throw new Error("GitHub admin identity was not saved.");

      stage = "session_creation";
      await startSession(request, {
        id: String(admin.github_id),
        login: admin.login,
        name: admin.name,
      });
      return response.redirect(loginResult(returnUrl, "success", "/admin"));
    } catch (error) {
      logFailure(logger, stage, error);
      return response.redirect(loginResult(returnUrl, "failed"));
    }
  });

  return router;
}

function isAllowedLogin(login, allowedLogins) {
  if (typeof login !== "string" || typeof allowedLogins !== "string") return false;
  const normalizedLogin = login.trim().toLowerCase();
  return allowedLogins.split(",").some((allowed) => allowed.trim().toLowerCase() === normalizedLogin);
}

function matchesState(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string" || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function loginResult(baseUrl, result, path = "/admin/login") {
  const url = new URL(path, baseUrl);
  url.searchParams.set("github_login", result);
  return url.toString();
}

function logFailure(logger, stage, error) {
  const details = { stage, name: typeof error?.name === "string" ? error.name : "Error" };
  const status = Number.isInteger(error?.status) ? error.status : error?.response?.status;
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : undefined;
  if (Number.isInteger(status)) details.status = status;
  if (code) details.code = code;
  logger.error("[github-oauth] sign-in step failed", details);
}
