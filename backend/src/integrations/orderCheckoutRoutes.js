import express from "express";
import { createGuestPaymentCredential } from "./orderPaymentRoutes.js";
import { getNearbyServicePoints, PostNordApiError } from "./postNordServicePointAdapter.js";
import { calculateShippingOptions, priceToMinorUnits, ShippingPricingError } from "./shippingPricing.js";

export function createOrderCheckoutRouter({
  database,
  lookupServicePoints = getNearbyServicePoints,
  createPaymentCredential = createGuestPaymentCredential,
  env = process.env,
} = {}) {
  const router = express.Router();

  router.post("/", async (request, response, next) => {
    const input = validateCheckout(request.body);
    if (!input) return response.status(400).json({ error: "Checkout details or shipping choice are invalid." });

    let selectedServicePoint = null;
    if (input.shippingMethod === "service-point") {
      try {
        const points = await lookupServicePoints(input.shippingPostalCode);
        selectedServicePoint = points.find((point) =>
          point.id === input.selectedServicePoint.id && point.countryCode === input.selectedServicePoint.countryCode,
        ) ?? null;
      } catch (error) {
        if (error instanceof PostNordApiError) {
          return response.status(error.status ?? 502).json({ error: error.message });
        }
        return next(error);
      }

      if (!selectedServicePoint) {
        return response.status(400).json({ error: "Det valda ombudet är inte längre tillgängligt. Hämta ombud igen." });
      }
    }

    const quantities = new Map();
    for (const item of input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    const paymentCredential = request.session?.userId ? null : createPaymentCredential();
    const client = await database.connect();

    try {
      await client.query("begin");
      const productIds = [...quantities.keys()];
      const products = await client.query(
        "select id, name, price, stock from products where id = any($1::uuid[]) and is_active=true for update",
        [productIds],
      );
      if (products.rowCount !== productIds.length) throw new CheckoutError("One or more products are unavailable.");

      let subtotalMinorUnits = 0n;
      const orderLines = [];
      for (const product of products.rows) {
        const quantity = quantities.get(product.id);
        if (quantity <= 0 || quantity > product.stock) {
          throw new CheckoutError("Requested quantity exceeds available stock.");
        }
        const priceMinorUnits = priceToMinorUnits(product.price);
        if (priceMinorUnits === null) throw new CheckoutError("A product price is invalid.");
        subtotalMinorUnits += BigInt(priceMinorUnits) * BigInt(quantity);
        if (subtotalMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new CheckoutError("Order total is too large.");
        orderLines.push({ product, quantity, price: decimalFromMinorUnits(BigInt(priceMinorUnits)) });
      }
      if (subtotalMinorUnits <= 0n) throw new CheckoutError("Order total must be greater than zero.");

      const shippingOption = calculateShippingOptions(Number(subtotalMinorUnits), env)
        .find((option) => option.method === input.shippingMethod);
      if (!shippingOption) throw new ShippingPricingError("Fraktpriset är inte tillgängligt.");
      const shippingMinorUnits = BigInt(shippingOption.price) * 100n;
      const totalMinorUnits = subtotalMinorUnits + shippingMinorUnits;
      if (totalMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new CheckoutError("Order total is too large.");

      const orderResult = await client.query(
        `insert into orders (user_id, customer_name, customer_email, customer_phone, shipping_address,
         shipping_postal_code, shipping_city, shipping_country, total_price, shipping_method, shipping_price,
         service_point_id, service_point_country_code, service_point_name, service_point_address,
         service_point_postal_code, service_point_city, status, guest_payment_token_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending',$18)
         returning id,total_price`,
        [
          request.session?.userId ?? null,
          input.customerName,
          input.customerEmail,
          input.customerPhone,
          input.shippingAddress,
          input.shippingPostalCode,
          input.shippingCity,
          input.shippingCountry,
          decimalFromMinorUnits(totalMinorUnits),
          input.shippingMethod,
          decimalFromMinorUnits(shippingMinorUnits),
          selectedServicePoint?.id ?? null,
          selectedServicePoint?.countryCode ?? null,
          selectedServicePoint?.name ?? null,
          selectedServicePoint?.address ?? null,
          selectedServicePoint?.postalCode ?? null,
          selectedServicePoint?.city ?? null,
          paymentCredential?.tokenHash ?? null,
        ],
      );
      const order = orderResult.rows[0];
      for (const line of orderLines) {
        await client.query(
          "insert into order_items (order_id, product_id, product_name, quantity, price_at_purchase) values ($1,$2,$3,$4,$5)",
          [order.id, line.product.id, line.product.name, line.quantity, line.price],
        );
      }

      await client.query("commit");
      return response.status(201).json({
        id: order.id,
        subtotalPrice: Number(subtotalMinorUnits) / 100,
        shippingPrice: shippingOption.price,
        totalPrice: Number(order.total_price),
        shippingMethod: input.shippingMethod,
        servicePoint: selectedServicePoint ? {
          id: selectedServicePoint.id,
          countryCode: selectedServicePoint.countryCode,
          name: selectedServicePoint.name,
          address: selectedServicePoint.address,
          postalCode: selectedServicePoint.postalCode,
          city: selectedServicePoint.city,
        } : null,
        ...(paymentCredential ? { paymentToken: paymentCredential.token } : {}),
      });
    } catch (error) {
      await client.query("rollback");
      if (error instanceof CheckoutError) return response.status(400).json({ error: error.message });
      if (error instanceof ShippingPricingError) {
        return response.status(503).json({ error: "Fraktpriset är inte tillgängligt just nu." });
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  return router;
}

function validateCheckout(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items) || value.items.length === 0) return null;
  const fields = ["customerName", "customerEmail", "customerPhone", "shippingAddress", "shippingPostalCode", "shippingCity", "shippingCountry"];
  if (fields.some((field) => typeof value[field] !== "string" || !value[field].trim() || value[field].length > 300)) return null;
  if (!isValidEmail(value.customerEmail.trim().toLowerCase())) return null;
  if (!value.items.every(isCartInput)) return null;
  if (value.shippingMethod !== "home" && value.shippingMethod !== "service-point") return null;

  let selectedServicePoint = null;
  if (value.shippingMethod === "service-point") {
    const point = value.selectedServicePoint;
    if (!point || typeof point !== "object" || typeof point.id !== "string" || !point.id.trim() || point.id.length > 100 ||
        point.countryCode !== "SE") return null;
    selectedServicePoint = { id: point.id, countryCode: point.countryCode };
  }

  return {
    customerName: value.customerName.trim(),
    customerEmail: value.customerEmail.trim().toLowerCase(),
    customerPhone: value.customerPhone.trim(),
    shippingAddress: value.shippingAddress.trim(),
    shippingPostalCode: value.shippingPostalCode.trim(),
    shippingCity: value.shippingCity.trim(),
    shippingCountry: value.shippingCountry.trim(),
    shippingMethod: value.shippingMethod,
    selectedServicePoint,
    items: value.items,
  };
}

function isCartInput(item) {
  return item && isUuid(item.productId) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function decimalFromMinorUnits(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

class CheckoutError extends Error {}
