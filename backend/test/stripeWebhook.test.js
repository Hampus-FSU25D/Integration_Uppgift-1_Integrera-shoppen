import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createStripeWebhookRouter } from "../src/integrations/stripeWebhookRoutes.js";

const orderId = "550e8400-e29b-41d4-a716-446655440000";

test("verified paid Checkout event marks order paid and reduces stock once", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  const result = await sendEvent({ database, event: paidEvent() });

  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), { received: true });
  assert.ok(database.queries.some(({ sql }) => /update products set stock=stock-\$1/.test(sql)));
  assert.ok(database.queries.some(({ sql, values }) => /update orders set status='confirmed'/.test(sql) && values[0] === orderId));
  assert.equal(database.queries.at(-1).sql, "commit");
});

test("duplicate paid Checkout event does not reduce stock again", async () => {
  const database = fakeDatabase({ orderStatus: "confirmed" });
  const result = await sendEvent({ database, event: paidEvent() });

  assert.equal(result.response.status, 200);
  assert.equal(database.queries.some(({ sql }) => /update products set stock=stock-\$1/.test(sql)), false);
});

test("expired Checkout Session cancels an unpaid order", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  const result = await sendEvent({
    database,
    event: { type: "checkout.session.expired", data: { object: { metadata: { orderId } } } },
  });

  assert.equal(result.response.status, 200);
  assert.ok(database.queries.some(({ sql }) => /update orders set status='cancelled'.*status='pending'/.test(sql)));
  assert.equal(database.queries.some(({ sql }) => /update products set stock=stock-\$1/.test(sql)), false);
});

test("invalid Stripe signature is rejected before touching the database", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  const result = await sendEvent({ database, verifyError: new Error("bad signature") });

  assert.equal(result.response.status, 400);
  assert.equal(database.queries.length, 0);
});

function paidEvent() {
  return {
    type: "checkout.session.completed",
    data: { object: {
      id: "cs_test_example",
      metadata: { orderId },
      mode: "payment",
      payment_status: "paid",
      livemode: false,
      currency: "sek",
      amount_total: 12345,
    } },
  };
}

function fakeDatabase({ orderStatus }) {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql: sql.trim(), values });
      if (/select id,total_price,status from orders/.test(sql)) {
        return { rows: [{ id: orderId, total_price: "123.45", status: orderStatus }], rowCount: 1 };
      }
      if (/select product_id,quantity from order_items/.test(sql)) {
        return { rows: [{ product_id: "991e8400-e29b-41d4-a716-446655440001", quantity: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql: sql.trim(), values });
      return { rows: [], rowCount: 1 };
    },
    async connect() { return client; },
  };
}

async function sendEvent({ database, event, verifyError }) {
  const app = express();
  app.use("/api/payments/stripe/webhook", createStripeWebhookRouter({
    database,
    constructEvent(rawBody, signature) {
      assert.ok(Buffer.isBuffer(rawBody));
      assert.equal(signature, "test-signature");
      if (verifyError) throw verifyError;
      return event;
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/payments/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
      body: JSON.stringify(event ?? {}),
    });
    return { response };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
