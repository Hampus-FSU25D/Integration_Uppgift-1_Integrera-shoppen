import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { constructStripeWebhookEvent, StripeWebhookError } from "../src/integrations/stripeWebhookAdapter.js";

const webhookSecret = "whsec_test_secret";
const env = { STRIPE_SECRET_KEY: "sk_test_example", STRIPE_WEBHOOK_SECRET: webhookSecret };

test("constructs a Stripe event only from its signed raw body", () => {
  const client = new Stripe(env.STRIPE_SECRET_KEY);
  const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", data: { object: {} } });
  const signature = client.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

  const event = constructStripeWebhookEvent(Buffer.from(payload), signature, { env, stripeClient: client });

  assert.equal(event.id, "evt_test");
  assert.equal(event.type, "checkout.session.completed");
});

test("rejects a Stripe event with an invalid signature", () => {
  const client = new Stripe(env.STRIPE_SECRET_KEY);

  assert.throws(
    () => constructStripeWebhookEvent(Buffer.from("{}"), "invalid", { env, stripeClient: client }),
    (error) => error instanceof StripeWebhookError,
  );
});
