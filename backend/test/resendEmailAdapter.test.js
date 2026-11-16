import assert from "node:assert/strict";
import test from "node:test";
import { sendOrderConfirmation } from "../src/integrations/resendEmailAdapter.js";

const order = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  customer_name: "Ada <script>alert(1)</script>",
  customer_email: "ada@example.com",
  total_price: "25.50",
};
const items = [{ product_name: "Tea & Coffee", quantity: 2, price_at_purchase: "10.25" }];
const env = { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "onboarding@resend.dev" };

test("sends an escaped text and HTML confirmation with an order idempotency key", async () => {
  let request;
  const result = await sendOrderConfirmation(order, items, {
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ id: "email_123" });
    },
  });

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers["Idempotency-Key"], `order-confirmation/${order.id}`);
  assert.equal(body.to[0], order.customer_email);
  assert.equal(body.subject, `Orderbekräftelse #${order.id.slice(0, 8)}`);
  assert.match(body.html, /Ada &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(body.html, /<script>/);
  assert.match(body.text, /Tea & Coffee × 2/);
  assert.match(body.text, /Totalsumma: 25,50 SEK/);
  assert.deepEqual(result, { id: "email_123" });
});

test("rejects a malformed successful Resend response", async () => {
  await assert.rejects(
    sendOrderConfirmation(order, items, { env, fetchImpl: async () => Response.json({}) }),
    /invalid response/i,
  );
});

test("rejects malformed order data before sending", async () => {
  let called = false;
  await assert.rejects(
    sendOrderConfirmation({ ...order, customer_email: "not-an-email" }, items, {
      env,
      fetchImpl: async () => { called = true; return Response.json({ id: "email_123" }); },
    }),
    /confirmation data is invalid/i,
  );
  assert.equal(called, false);
});
