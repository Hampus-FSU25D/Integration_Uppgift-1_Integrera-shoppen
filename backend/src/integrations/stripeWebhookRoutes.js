import express from "express";
import { constructStripeWebhookEvent } from "./stripeWebhookAdapter.js";

export function createStripeWebhookRouter({ database, constructEvent = constructStripeWebhookEvent }) {
  const router = express.Router();

  router.post("/", express.raw({ type: "application/json", limit: "100kb" }), async (request, response, next) => {
    let event;
    try {
      event = constructEvent(request.body, request.get("stripe-signature"));
    } catch {
      return response.status(400).json({ error: "Stripe webhook request is invalid." });
    }

    const session = event?.data?.object;
    if (event?.type === "checkout.session.expired") {
      const orderId = session?.metadata?.orderId;
      if (!isUuid(orderId)) return response.status(400).json({ error: "Stripe Checkout Session is invalid." });
      try {
        await database.query(
          "update orders set status='cancelled',updated_at=now() where id=$1 and status='pending'",
          [orderId],
        );
        return response.json({ received: true });
      } catch (error) {
        return next(error);
      }
    }

    if (event?.type !== "checkout.session.completed" && event?.type !== "checkout.session.async_payment_succeeded") {
      return response.json({ received: true });
    }
    if (!isPaidTestSession(session)) return response.status(400).json({ error: "Stripe Checkout Session is invalid." });
    if (session.payment_status !== "paid") return response.json({ received: true });

    const orderId = session.metadata.orderId;
    const client = await database.connect();
    try {
      await client.query("begin");
      const orderResult = await client.query(
        "select id,total_price,status from orders where id=$1 for update",
        [orderId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        await client.query("rollback");
        return response.json({ received: true });
      }
      if (order.status !== "pending") {
        await client.query("commit");
        return response.json({ received: true });
      }
      if (toMinorUnits(order.total_price) !== session.amount_total) {
        await client.query("rollback");
        return response.status(400).json({ error: "Stripe payment amount does not match the order." });
      }

      const itemResult = await client.query(
        "select product_id,quantity from order_items where order_id=$1",
        [orderId],
      );
      for (const item of itemResult.rows) {
        if (!item.product_id) throw new Error("Order item has no product.");
        const stockResult = await client.query(
          "update products set stock=stock-$1,updated_at=now() where id=$2 and stock >= $1",
          [item.quantity, item.product_id],
        );
        if (!stockResult.rowCount) throw new Error("Insufficient stock for paid order.");
      }
      await client.query("update orders set status='confirmed',updated_at=now() where id=$1", [orderId]);
      await client.query("commit");
      return response.json({ received: true });
    } catch (error) {
      await client.query("rollback");
      return next(error);
    } finally {
      client.release();
    }
  });

  return router;
}

function isPaidTestSession(session) {
  return session && typeof session === "object" &&
    session.mode === "payment" && session.livemode === false && session.currency === "sek" &&
    Number.isSafeInteger(session.amount_total) && session.amount_total > 0 &&
    typeof session.id === "string" && session.id.startsWith("cs_test_") &&
    isUuid(session.metadata?.orderId);
}

function toMinorUnits(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
