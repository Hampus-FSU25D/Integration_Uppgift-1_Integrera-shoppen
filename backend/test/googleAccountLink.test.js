import assert from "node:assert/strict";
import test from "node:test";
import { linkPendingGoogleIdentity } from "../src/integrations/googleAccountLink.js";

const customer = { id: "user-1", email: "customer@example.com", role: "customer" };
const pending = { sub: "google-123", email: "customer@example.com", name: "Customer", requestedAt: 1_000 };

function createDatabase(rows = [{ id: customer.id }]) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows };
    },
  };
}

test("links the pending Google identity only to the matching customer account", async () => {
  const database = createDatabase();

  const result = await linkPendingGoogleIdentity(database, customer, pending, 2_000);

  assert.equal(result, true);
  assert.match(database.calls[0].sql, /google_sub is null or google_sub = \$1/);
  assert.deepEqual(database.calls[0].values, ["google-123", "user-1"]);
});

test("does not link a Google identity to a different email account", async () => {
  const database = createDatabase();

  await assert.rejects(linkPendingGoogleIdentity(database, {
    ...customer,
    email: "other@example.com",
  }, pending, 2_000), /same email address/i);
  assert.equal(database.calls.length, 0);
});

test("lets password login continue without linking an expired Google identity", async () => {
  const database = createDatabase();

  const result = await linkPendingGoogleIdentity(database, customer, pending, 602_000);

  assert.equal(result, false);
  assert.equal(database.calls.length, 0);
});

test("does not replace a different Google identity already linked to the customer", async () => {
  const database = createDatabase([]);

  await assert.rejects(linkPendingGoogleIdentity(database, customer, pending, 2_000), /already linked/i);
  assert.equal(database.calls.length, 1);
});
