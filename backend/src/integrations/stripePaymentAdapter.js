import Stripe from "stripe";
import { pool } from "../db/pool.js";

const requestTimeoutMs = 10_000;

export async function createStripeCheckoutSession(orderId, {
  database = pool,
  stripeClient,
  env = process.env,
} = {}) {
  if (!isUuid(orderId)) throw new StripePaymentError("Order ID is invalid.");

  let order;
  try {
    const result = await database.query(
      "select id,customer_email,total_price,status from orders where id=$1",
      [orderId],
    );
    order = result.rows[0];
  } catch {
    throw new StripePaymentError("The order could not be loaded.");
  }

  if (!order) throw new StripePaymentError("Order not found.");
  if (order.status !== "pending") throw new StripePaymentError("Only pending orders can be paid.");
  if (typeof order.customer_email !== "string" || !isValidEmail(order.customer_email)) {
    throw new StripePaymentError("The order does not have a valid customer email.");
  }

  const amount = toMinorUnits(order.total_price);
  if (amount === null || amount <= 0) throw new StripePaymentError("Order total is not a valid SEK amount.");

  const apiKey = env.STRIPE_SECRET_KEY;
  if (typeof apiKey !== "string" || !/^sk_test_[A-Za-z0-9]+$/.test(apiKey)) {
    throw new StripePaymentError("A test-mode Stripe secret key must be configured.");
  }
  const successUrl = validateReturnUrl(env.STRIPE_SUCCESS_URL, true);
  const cancelUrl = validateReturnUrl(env.STRIPE_CANCEL_URL);
  if (!successUrl || !cancelUrl) throw new StripePaymentError("Stripe success and cancel URLs must be configured as HTTP(S) URLs.");

  let session;
  try {
    const client = stripeClient ?? new Stripe(apiKey, { timeout: requestTimeoutMs });
    const orderNumber = `#${order.id.slice(0, 8)}`;
    session = await client.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer_email,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber },
      payment_intent_data: {
        description: `Order ${orderNumber}`,
        metadata: { orderId: order.id, orderNumber },
      },
      success_url: successUrl.replace("{ORDER_ID}", order.id),
      cancel_url: cancelUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "sek",
          unit_amount: amount,
          product_data: { name: `Order ${orderNumber}` },
        },
      }],
    });
  } catch {
    throw new StripePaymentError("Stripe Checkout is unavailable. Please try again later.");
  }

  if (!session || typeof session.id !== "string" || !session.id.startsWith("cs_test_") ||
      session.livemode !== false || !isHttpsUrl(session.url)) {
    throw new StripePaymentError("Stripe returned an invalid Checkout Session.");
  }

  return { id: session.id, url: session.url };
}

function toMinorUnits(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function validateReturnUrl(value, needsSessionPlaceholder = false) {
  if (typeof value !== "string" || (needsSessionPlaceholder &&
      (!value.includes("{CHECKOUT_SESSION_ID}") || !value.includes("{ORDER_ID}")))) return null;
  const urlText = needsSessionPlaceholder
    ? value.replace("{CHECKOUT_SESSION_ID}", "test-session").replace("{ORDER_ID}", "test-order")
    : value;
  try {
    const url = new URL(urlText);
    return ["http:", "https:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export class StripePaymentError extends Error {}
