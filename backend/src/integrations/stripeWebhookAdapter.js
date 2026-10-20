import Stripe from "stripe";

const requestTimeoutMs = 10_000;

export function constructStripeWebhookEvent(rawBody, signature, { stripeClient, env = process.env } = {}) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !signature) {
    throw new StripeWebhookError("Stripe webhook request is invalid.");
  }

  const apiKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (typeof apiKey !== "string" || !/^sk_test_[A-Za-z0-9]+$/.test(apiKey) ||
      typeof webhookSecret !== "string" || !webhookSecret.startsWith("whsec_")) {
    throw new StripeWebhookError("Stripe webhook test credentials are not configured.");
  }

  try {
    const client = stripeClient ?? new Stripe(apiKey, { timeout: requestTimeoutMs });
    return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new StripeWebhookError("Stripe webhook signature is invalid.");
  }
}

export class StripeWebhookError extends Error {}
