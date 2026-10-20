import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createGuestPaymentCredential,
  createOrderPaymentRouter,
  hashGuestPaymentToken,
} from "../src/integrations/orderPaymentRoutes.js";

const orderId = "550e8400-e29b-41d4-a716-446655440000";

test("guest payment token is random and can only be stored as a hash", () => {
  const first = createGuestPaymentCredential();
  const second = createGuestPaymentCredential();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.tokenHash, hashGuestPaymentToken(first.token));
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
});

test("guest can create a session with the matching token, and the query uses its hash", async () => {
  const credential = createGuestPaymentCredential();
  const calls = [];
  const result = await requestPaymentSession({
    credential,
    database: {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ id: orderId, status: "pending" }] };
      },
    },
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), { id: "cs_test_example", url: "https://checkout.stripe.com/session" });
  assert.match(calls[0].sql, /guest_payment_token_hash/);
  assert.equal(calls[0].values[2], credential.tokenHash);
  assert.notEqual(calls[0].values[2], credential.token);
  assert.equal(result.sessionCalls, 1);
});

test("guest without a valid payment token cannot start a session", async () => {
  const result = await requestPaymentSession({
    paymentToken: "invalid",
    database: { async query() { throw new Error("Should not query without a token."); } },
  });

  assert.equal(result.response.status, 404);
  assert.deepEqual(await result.response.json(), { error: "Order not found or payment is not authorized." });
  assert.equal(result.sessionCalls, 0);
});

test("signed-in owner can start a session without a guest token", async () => {
  const result = await requestPaymentSession({
    userId: "991e8400-e29b-41d4-a716-446655440001",
    database: { async query(_sql, values) {
      assert.equal(values[1], "991e8400-e29b-41d4-a716-446655440001");
      assert.equal(values[2], null);
      return { rows: [{ id: orderId, status: "pending" }] };
    } },
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.sessionCalls, 1);
});

test("signed-in customer cannot pay an order owned by someone else", async () => {
  const result = await requestPaymentSession({
    userId: "991e8400-e29b-41d4-a716-446655440001",
    database: { async query(_sql, values) {
      assert.equal(values[1], "991e8400-e29b-41d4-a716-446655440001");
      return { rows: [] };
    } },
  });

  assert.equal(result.response.status, 404);
  assert.equal(result.sessionCalls, 0);
});

test("unauthorized, missing, and non-pending orders do not create a session", async () => {
  const credential = createGuestPaymentCredential();
  const unauthorized = await requestPaymentSession({
    credential,
    database: { async query() { return { rows: [] }; } },
  });
  assert.equal(unauthorized.response.status, 404);

  const paidOrder = await requestPaymentSession({
    credential,
    database: { async query() { return { rows: [{ id: orderId, status: "processing" }] }; } },
  });
  assert.equal(paidOrder.response.status, 409);
  assert.deepEqual(await paidOrder.response.json(), { error: "Only pending orders can be paid." });
  assert.equal(unauthorized.sessionCalls + paidOrder.sessionCalls, 0);
});

async function requestPaymentSession({ credential, paymentToken, userId, database }) {
  const app = express();
  let sessionCalls = 0;
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = { userId };
    next();
  });
  app.use("/api/orders", createOrderPaymentRouter({
    database,
    async createSession() {
      sessionCalls += 1;
      return { id: "cs_test_example", url: "https://checkout.stripe.com/session" };
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/${orderId}/payment-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credential ? { paymentToken: credential.token } : paymentToken ? { paymentToken } : {}),
    });
    return { response, sessionCalls };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
