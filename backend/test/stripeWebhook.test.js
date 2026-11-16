import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { sendOrderConfirmation } from "../src/integrations/resendEmailAdapter.js";
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

test("paid Checkout event sends the confirmation after the order transaction commits", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  let confirmation;
  const result = await sendEvent({
    database,
    event: paidEvent(),
    sendConfirmation: async (order, items) => {
      confirmation = { order, items, committed: database.queries.at(-1).sql === "commit" };
    },
  });

  assert.equal(result.response.status, 200);
  assert.equal(confirmation.order.customer_email, "buyer@example.com");
  assert.equal(confirmation.items[0].product_name, "Test product");
  assert.equal(confirmation.committed, true);
});

test("paid Checkout event builds a Resend email without external services", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  let resendRequest;
  const result = await sendEvent({
    database,
    event: paidEvent(),
    sendConfirmation: (order, items) => sendOrderConfirmation(order, items, {
      env: { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "onboarding@resend.dev" },
      fetchImpl: async (url, options) => {
        resendRequest = { url, options };
        return Response.json({ id: "email_test" });
      },
    }),
  });

  const email = JSON.parse(resendRequest.options.body);
  assert.equal(result.response.status, 200);
  assert.equal(resendRequest.url, "https://api.resend.com/emails");
  assert.deepEqual(email.to, ["buyer@example.com"]);
  assert.match(email.subject, /550e8400/);
  assert.match(email.html, /Test product/);
  assert.match(email.text, /123,45 SEK/);
  assert.equal(resendRequest.options.headers["Idempotency-Key"], `order-confirmation/${orderId}`);
});

test("repeated paid Checkout event requests the same idempotent confirmation without reducing stock", async () => {
  const database = fakeDatabase({ orderStatus: "confirmed" });
  let confirmationCount = 0;
  const result = await sendEvent({
    database,
    event: paidEvent(),
    sendConfirmation: async () => { confirmationCount += 1; },
  });

  assert.equal(result.response.status, 200);
  assert.equal(confirmationCount, 1);
  assert.equal(database.queries.some(({ sql }) => /update products set stock=stock-\$1/.test(sql)), false);
});

test("email delivery failure does not undo payment or return an error to Stripe", async () => {
  const database = fakeDatabase({ orderStatus: "pending" });
  const errors = [];
  const result = await sendEvent({
    database,
    event: paidEvent(),
    sendConfirmation: async () => { throw new Error("Resend unavailable"); },
    logger: { error: (...values) => errors.push(values) },
  });

  assert.equal(result.response.status, 200);
  assert.ok(database.queries.some(({ sql }) => /update orders set status='confirmed'/.test(sql)));
  assert.equal(errors[0][0], "Order confirmation email failed");
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
      if (/select id,total_price,status,customer_name,customer_email from orders/.test(sql)) {
        return { rows: [{ id: orderId, total_price: "123.45", status: orderStatus, customer_name: "Test buyer", customer_email: "buyer@example.com" }], rowCount: 1 };
      }
      if (/select product_id,product_name,quantity,price_at_purchase from order_items/.test(sql)) {
        return { rows: [{ product_id: "991e8400-e29b-41d4-a716-446655440001", product_name: "Test product", quantity: 2, price_at_purchase: "61.72" }], rowCount: 1 };
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

async function sendEvent({ database, event, verifyError, sendConfirmation = async () => {}, logger }) {
  const app = express();
  app.use("/api/payments/stripe/webhook", createStripeWebhookRouter({
    database,
    sendConfirmation,
    logger,
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
