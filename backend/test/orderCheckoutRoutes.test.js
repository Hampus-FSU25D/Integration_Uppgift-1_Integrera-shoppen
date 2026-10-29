import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createOrderCheckoutRouter } from "../src/integrations/orderCheckoutRoutes.js";
import { PostNordApiError } from "../src/integrations/postNordServicePointAdapter.js";

const productId = "550e8400-e29b-41d4-a716-446655440000";
const servicePoint = {
  id: "point-1",
  countryCode: "SE",
  name: "Ombud",
  address: "Testgatan 1",
  postalCode: "41104",
  city: "Göteborg",
};

function createDependencies({ products = [{ id: productId, name: "Testprodukt", price: "12.34", stock: 5 }], points = [servicePoint], lookupError } = {}) {
  const calls = [];
  let connections = 0;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("from products")) return { rows: products, rowCount: products.length };
      if (sql.includes("insert into orders")) return { rows: [{ id: "660e8400-e29b-41d4-a716-446655440001", total_price: values[8] }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    calls,
    get connections() { return connections; },
    database: { async connect() { connections += 1; return client; } },
    async lookup(postalCode) {
      if (lookupError) throw lookupError;
      assert.equal(postalCode, "41104");
      return points;
    },
    env: {
      SHIPPING_SERVICE_POINT_PRICE_SEK: "59",
      SHIPPING_HOME_PRICE_SEK: "99",
      SHIPPING_FREE_THRESHOLD_SEK: "500",
    },
  };
}

function checkoutBody(overrides = {}) {
  return {
    customerName: "Test Customer",
    customerEmail: "buyer@example.com",
    customerPhone: "0701234567",
    shippingAddress: "Testgatan 1",
    shippingPostalCode: "41104",
    shippingCity: "Göteborg",
    shippingCountry: "Sverige",
    shippingMethod: "service-point",
    selectedServicePoint: { id: servicePoint.id, countryCode: servicePoint.countryCode },
    items: [{ productId, quantity: 2, price: 0 }],
    shippingPrice: 0,
    ...overrides,
  };
}

async function createOrder(body, dependencies) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = { userId: null };
    next();
  });
  app.use("/api/orders", createOrderCheckoutRouter({
    database: dependencies.database,
    lookupServicePoints: dependencies.lookup,
    env: dependencies.env,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("persists selected service point and calculates order total from database prices", async () => {
  const dependencies = createDependencies();
  const response = await createOrder(checkoutBody(), dependencies);

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.subtotalPrice, 24.68);
  assert.equal(result.shippingPrice, 59);
  assert.equal(result.totalPrice, 83.68);
  assert.deepEqual(result.servicePoint, servicePoint);

  const insert = dependencies.calls.find((call) => call.sql.includes("insert into orders"));
  assert.match(insert.sql, /shipping_method/);
  assert.deepEqual(insert.values.slice(8, 13), ["83.68", "service-point", "59.00", "point-1", "SE"]);
  assert.equal(dependencies.calls.some((call) => call.sql.includes("insert into order_items") && call.values[4] === "12.34"), true);
});

test("uses configured free shipping for home delivery without requiring an ombud", async () => {
  const dependencies = createDependencies({ products: [{ id: productId, name: "Testprodukt", price: "500.00", stock: 5 }] });
  const response = await createOrder(checkoutBody({
    shippingMethod: "home",
    selectedServicePoint: null,
    items: [{ productId, quantity: 1 }],
  }), dependencies);

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.subtotalPrice, 500);
  assert.equal(result.shippingPrice, 0);
  assert.equal(result.totalPrice, 500);
  assert.equal(dependencies.calls.some((call) => call.sql.includes("insert into orders") && call.values[9] === "home"), true);
  assert.equal(dependencies.connections, 1);
});

test("rejects a service point that is not in the fresh PostNord lookup", async () => {
  const dependencies = createDependencies({ points: [] });
  const response = await createOrder(checkoutBody(), dependencies);

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /ombud/i);
  assert.equal(dependencies.connections, 0);
});

test("maps PostNord lookup failure to a controlled response without creating an order", async () => {
  const dependencies = createDependencies({ lookupError: new PostNordApiError("PostNord unavailable", { status: 502 }) });
  const response = await createOrder(checkoutBody(), dependencies);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "PostNord unavailable" });
  assert.equal(dependencies.connections, 0);
});

test("rejects unsupported shipping methods", async () => {
  const dependencies = createDependencies();
  const response = await createOrder(checkoutBody({ shippingMethod: "express" }), dependencies);

  assert.equal(response.status, 400);
  assert.equal(dependencies.connections, 0);
});
