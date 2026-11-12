import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import test, { after } from "node:test";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.LAB6_TEST_DATABASE_URL;
if (!connectionString) throw new Error("LAB6_TEST_DATABASE_URL must point to the isolated local test database.");

const testDatabase = new URL(connectionString);
if (testDatabase.hostname !== "127.0.0.1" || testDatabase.port !== "55432" ||
    testDatabase.pathname !== "/shop_lab6_auth_test" || testDatabase.username !== "lab6_test") {
  throw new Error("Refusing to run Google identity migration tests outside the isolated local test database.");
}

const database = new Pool({ connectionString });
const existingEmail = "existing-password-user@lab6.test";
const expectedPasswordHash = `scrypt$lab6-test-salt$${scryptSync("preserved-password-123", "lab6-test-salt", 64).toString("hex")}`;

after(async () => database.end());

test("Google identity migration supports passwordless accounts and keeps password login data", async () => {
  const columns = await database.query(
    `select column_name, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'users'`,
  );
  const columnByName = new Map(columns.rows.map((column) => [column.column_name, column]));

  assert.equal(columnByName.get("name")?.is_nullable, "YES");
  assert.equal(columnByName.get("google_sub")?.is_nullable, "YES");
  assert.equal(columnByName.get("password_hash")?.is_nullable, "YES");

  const oldCustomer = await database.query("select id, password_hash, role from users where email = $1", [existingEmail]);
  assert.equal(oldCustomer.rowCount, 1);
  assert.equal(oldCustomer.rows[0].password_hash, expectedPasswordHash);
  assert.equal(oldCustomer.rows[0].role, "customer");
});

test("Google login reuses the customer identified by sub and rejects account collisions", async () => {
  const email = `google-${randomUUID()}@lab6.test`;
  const googleSub = `google-${randomUUID()}`;

  try {
    const created = await database.query(
      "insert into users (email, name, google_sub, password_hash, role) values ($1, $2, $3, null, 'customer') returning id",
      [email, "Google Test Customer", googleSub],
    );
    const existing = await database.query("select id, email, name, role from users where google_sub = $1", [googleSub]);

    assert.equal(existing.rowCount, 1);
    assert.equal(existing.rows[0].id, created.rows[0].id);
    assert.equal(existing.rows[0].email, email);
    assert.equal(existing.rows[0].name, "Google Test Customer");
    assert.equal(existing.rows[0].role, "customer");

    await assert.rejects(
      database.query(
        "insert into users (email, name, google_sub, password_hash, role) values ($1, $2, $3, null, 'customer')",
        [`other-${randomUUID()}@lab6.test`, "Duplicate identity", googleSub],
      ),
      (error) => error.code === "23505",
    );
    await assert.rejects(
      database.query(
        "insert into users (email, name, google_sub, password_hash, role) values ($1, $2, $3, null, 'customer')",
        [email, "Separate identity", `google-${randomUUID()}`],
      ),
      (error) => error.code === "23505",
    );
    await assert.rejects(
      database.query("insert into users (email, password_hash, role) values ($1, null, 'customer')", [`empty-${randomUUID()}@lab6.test`]),
      (error) => error.code === "23514",
    );
  } finally {
    await database.query("delete from users where google_sub = $1", [googleSub]);
  }
});
