const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

export class GoogleAccountLinkError extends Error {}

export async function linkPendingGoogleIdentity(database, user, pending, now = Date.now()) {
  if (!pending || !Number.isFinite(pending.requestedAt) || now - pending.requestedAt > PENDING_LINK_TTL_MS || pending.requestedAt > now) return false;
  if (user.role !== "customer" || normalizeEmail(user.email) !== normalizeEmail(pending.email)) {
    throw new GoogleAccountLinkError("Log in with the account that has the same email address as Google.");
  }

  let result;
  try {
    result = await database.query(
      "update users set google_sub = $1, updated_at = now() where id = $2 and role = 'customer' and (google_sub is null or google_sub = $1) returning id",
      [pending.sub, user.id],
    );
  } catch (error) {
    if (error?.code === "23505") {
      throw new GoogleAccountLinkError("This Google account is already linked to another customer account.");
    }
    throw error;
  }

  if (!result.rows[0]) {
    throw new GoogleAccountLinkError("This customer account is already linked to a different Google account.");
  }
  return true;
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
