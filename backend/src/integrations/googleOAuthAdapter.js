import { OAuth2Client } from "google-auth-library";

const scopes = ["openid", "email", "profile"];
const requestTimeoutMs = 8_000;

export class GoogleOAuthError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = "GoogleOAuthError";
    this.status = status;
  }
}

export function createGoogleOAuthAdapter({ env = process.env, timeoutMs = requestTimeoutMs, oauthClient } = {}) {
  let configuredClient = oauthClient ?? null;
  let clientId = "";
  let timeoutConfigured = false;

  function getClient() {
    const config = readConfig(env);
    clientId = config.clientId;
    configuredClient ??= new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      transporterOptions: { timeout: timeoutMs, retry: false },
      useAuthRequestParameters: false,
    });
    if (!timeoutConfigured) {
      configuredClient.transporter.interceptors.request.add({
        resolved(options) {
          options.timeout = timeoutMs;
          options.retry = false;
          options.retryConfig = { ...options.retryConfig, retry: 0 };
          return options;
        },
      });
      timeoutConfigured = true;
    }
    return configuredClient;
  }

  function createAuthorizationUrl(state) {
    if (typeof state !== "string" || state.length < 32 || state.length > 256) {
      throw new GoogleOAuthError("Google-inloggningen kunde inte startas. Försök igen.", { status: 400 });
    }

    return getClient().generateAuthUrl({ scope: scopes, state });
  }

  async function exchangeCode(code) {
    if (typeof code !== "string" || !code.trim() || code.length > 2048) {
      throw new GoogleOAuthError("Google returnerade en ogiltig inloggning.", { status: 400 });
    }

    try {
      const client = getClient();
      const { tokens } = await client.getToken(code);
      if (typeof tokens?.id_token !== "string" || tokens.id_token.length > 16_384) {
        throw new Error("Missing or malformed ID token.");
      }

      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      return validateIdentity(ticket.getPayload(), clientId);
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw error;
      throw new GoogleOAuthError("Google kunde inte verifiera inloggningen. Försök igen.");
    }
  }

  return { createAuthorizationUrl, exchangeCode };
}

function readConfig(env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthError("Google-inloggning är inte konfigurerad.", { status: 503 });
  }

  let callback;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new GoogleOAuthError("Google-inloggning är inte korrekt konfigurerad.", { status: 503 });
  }

  const isLocalHttp = callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!isLocalHttp && callback.protocol !== "https:") || callback.pathname !== "/api/auth/google/callback" ||
      callback.search || callback.hash || callback.username || callback.password) {
    throw new GoogleOAuthError("Google-inloggning är inte korrekt konfigurerad.", { status: 503 });
  }

  return { clientId, clientSecret, redirectUri };
}

function validateIdentity(payload, clientId) {
  const validIssuer = payload?.iss === "https://accounts.google.com" || payload?.iss === "accounts.google.com";
  const validAudience = payload?.aud === clientId || Array.isArray(payload?.aud) && payload.aud.includes(clientId);
  const validExpiration = Number.isInteger(payload?.exp) && payload.exp * 1000 > Date.now();
  const sub = typeof payload?.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!validIssuer || !validAudience || !validExpiration || !sub || sub.length > 255 ||
      !validEmail || payload.email_verified !== true || !name || name.length > 200) {
    throw new Error("Google identity claims are invalid.");
  }

  return { sub, email, name };
}
