import assert from "node:assert/strict";
import test from "node:test";
import { createStripeCheckoutSession, StripePaymentError } from "../src/integrations/stripePaymentAdapter.js";

const validEnvironment = {
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_SUCCESS_URL: "https://shop.example/order-confirmation/{ORDER_ID}?session_id={CHECKOUT_SESSION_ID}",
  STRIPE_CANCEL_URL: "https://shop.example/checkout/cancel",
};

function dependencies(order, session = { id: "cs_test_example", url: "https://checkout.stripe.com/session", livemode: false }) {
  const calls = [];
  return {
    calls,
    database: {
      async query(...args) {
        calls.push({ type: "query", args });
        return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
      },
    },
    stripeClient: {
      checkout: { sessions: { async create(...args) { calls.push({ type: "stripe", args }); return session; } } },
    },
  };
}

test("creates a SEK Checkout Session using the pending order total from the database", async () => {
  const deps = dependencies({ id: "550e8400-e29b-41d4-a716-446655440000", status: "pending", customer_email: "buyer@example.com", total_price: "123.45" });

  const result = await createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...deps, env: { ...validEnvironment },
  });

  assert.deepEqual(result, { id: "cs_test_example", url: "https://checkout.stripe.com/session" });
  assert.equal(deps.calls[0].args[1][0], "550e8400-e29b-41d4-a716-446655440000");
  const [params] = deps.calls.find((call) => call.type === "stripe").args;
  assert.equal(params.success_url, "https://shop.example/order-confirmation/550e8400-e29b-41d4-a716-446655440000?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.line_items[0].price_data.currency, "sek");
  assert.equal(params.line_items[0].price_data.unit_amount, 12345);
  assert.equal(params.customer_email, "buyer@example.com");
  assert.equal(params.client_reference_id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(params.metadata.orderId, "550e8400-e29b-41d4-a716-446655440000");
});

test("rejects malformed order IDs before querying the database", async () => {
  const deps = dependencies(null);
  await assert.rejects(
    createStripeCheckoutSession("not-an-order-id", { ...deps, env: validEnvironment }),
    (error) => error instanceof StripePaymentError && /order ID/i.test(error.message),
  );
  assert.equal(deps.calls.length, 0);
});

test("rejects missing or non-pending orders", async () => {
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...dependencies(null), env: validEnvironment,
  }), /Order not found/);
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...dependencies({ status: "processing", total_price: "123.45" }), env: validEnvironment,
  }), /pending/);
});

test("rejects unsupported monetary precision instead of rounding the total", async () => {
  const deps = dependencies({ status: "pending", customer_email: "buyer@example.com", total_price: "12.345" });
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...deps, env: validEnvironment,
  }), /valid SEK amount/);
  assert.equal(deps.calls.some((call) => call.type === "stripe"), false);
});

test("maps Stripe failures to a controlled payment error", async () => {
  const deps = dependencies({ status: "pending", customer_email: "buyer@example.com", total_price: "12.34" });
  deps.stripeClient.checkout.sessions.create = async () => { throw new Error("provider detail"); };
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...deps, env: validEnvironment,
  }), (error) => error instanceof StripePaymentError && /Stripe Checkout is unavailable/.test(error.message));
});

test("requires a Stripe test key and validates the returned session", async () => {
  const deps = dependencies({ status: "pending", customer_email: "buyer@example.com", total_price: "12.34" });
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...deps, env: { ...validEnvironment, STRIPE_SECRET_KEY: "sk_live_example" },
  }), /test-mode Stripe secret key/);

  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...dependencies({ status: "pending", customer_email: "buyer@example.com", total_price: "12.34" }, { id: "cs_live_example", url: "http://unsafe.example", livemode: true }),
    env: validEnvironment,
  }), /invalid Checkout Session/);
});

test("requires success URL placeholders for the Checkout Session and order ID", async () => {
  const deps = dependencies({ status: "pending", customer_email: "buyer@example.com", total_price: "12.34" });
  await assert.rejects(createStripeCheckoutSession("550e8400-e29b-41d4-a716-446655440000", {
    ...deps, env: { ...validEnvironment, STRIPE_SUCCESS_URL: "https://shop.example/order-confirmation/{ORDER_ID}" },
  }), /URLs must be configured/);
  assert.equal(deps.calls.some((call) => call.type === "stripe"), false);
});
