import express from "express";
import { calculateShippingOptions, priceToMinorUnits, ShippingPricingError } from "./shippingPricing.js";

export function createShippingQuoteRouter({ database, env = process.env } = {}) {
  const router = express.Router();

  router.post("/", async (request, response, next) => {
    const quantities = readQuantities(request.body?.items);
    if (!quantities) return response.status(400).json({ error: "Varukorgens produkter eller antal är ogiltiga." });

    try {
      const productIds = [...quantities.keys()];
      const result = await database.query(
        "select id, price, stock from products where id = any($1::uuid[]) and is_active=true",
        [productIds],
      );
      if (result.rowCount !== productIds.length) {
        return response.status(400).json({ error: "En eller flera produkter är inte längre tillgängliga." });
      }

      let subtotalMinorUnits = 0n;
      for (const product of result.rows) {
        const priceMinorUnits = priceToMinorUnits(product.price);
        const quantity = quantities.get(product.id);
        if (priceMinorUnits === null || !Number.isInteger(product.stock) || quantity > product.stock) {
          return response.status(400).json({ error: "En eller flera produkter är inte längre tillgängliga i valt antal." });
        }
        subtotalMinorUnits += BigInt(priceMinorUnits) * BigInt(quantity);
      }

      if (subtotalMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ShippingPricingError("Fraktpriserna kunde inte beräknas.");
      }
      const options = calculateShippingOptions(Number(subtotalMinorUnits), env).map((option) => ({
        ...option,
        totalPrice: Number(subtotalMinorUnits + BigInt(option.price) * 100n) / 100,
      }));

      return response.json({ subtotalPrice: Number(subtotalMinorUnits) / 100, options });
    } catch (error) {
      if (error instanceof ShippingPricingError) {
        return response.status(503).json({ error: "Fraktpriserna är inte tillgängliga just nu." });
      }
      return next(error);
    }
  });

  return router;
}

function readQuantities(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return null;
  const quantities = new Map();
  for (const item of items) {
    if (!item || !isUuid(item.productId) || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 99) {
      return null;
    }
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) return null;
    quantities.set(item.productId, quantity);
  }
  return quantities;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
