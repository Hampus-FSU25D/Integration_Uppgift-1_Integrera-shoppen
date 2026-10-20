import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { createStripeCheckoutSession, StripePaymentError } from "./stripePaymentAdapter.js";

export function createGuestPaymentCredential() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashGuestPaymentToken(token) };
}

export function hashGuestPaymentToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function createOrderPaymentRouter({ database, createSession = createStripeCheckoutSession }) {
  const router = express.Router();

  router.post("/:id/payment-session", async (request, response, next) => {
    const { id: orderId } = request.params;
    if (!isUuid(orderId)) return response.status(400).json({ error: "Order ID is invalid." });

    const userId = request.session?.userId ?? null;
    const paymentToken = request.body?.paymentToken;
    const tokenHash = userId ? null : hashGuestPaymentToken(paymentToken);
    if (!userId && !tokenHash) {
      return response.status(404).json({ error: "Order not found or payment is not authorized." });
    }

    try {
      const result = await database.query(
        `select id,status from orders where id=$1 and (
           (user_id=$2 and $2 is not null) or
           (user_id is null and guest_payment_token_hash=$3 and $3 is not null)
         )`,
        [orderId, userId, tokenHash],
      );
      const order = result.rows[0];
      if (!order) return response.status(404).json({ error: "Order not found or payment is not authorized." });
      if (order.status !== "pending") return response.status(409).json({ error: "Only pending orders can be paid." });

      const session = await createSession(orderId);
      return response.json({ id: session.id, url: session.url });
    } catch (error) {
      if (error instanceof StripePaymentError) return response.status(502).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
