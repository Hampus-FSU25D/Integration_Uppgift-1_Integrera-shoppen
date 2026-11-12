import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createOrderHistoryRouter } from "../src/integrations/orderHistoryRoutes.js";

async function request(userId) {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.session = { userId };
    next();
  });
  app.use("/api/orders", createOrderHistoryRouter({
    database: {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ id: "order-1", total_price: "25.50", status: "confirmed", created_at: new Date("2026-11-01T12:00:00Z"), items: [] }] };
      },
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/mine`);
    return { response, calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("requires an authenticated customer and returns 401 without querying orders", async () => {
  const { response, calls } = await request(null);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Login required." });
  assert.equal(calls.length, 0);
});

test("loads order history only for the signed-in session user", async () => {
  const { response, calls } = await request("customer-123");

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].values, ["customer-123"]);
  assert.match(calls[0].sql, /where o\.user_id = \$1/);
  assert.deepEqual(await response.json(), [{
    id: "order-1",
    totalPrice: 25.5,
    status: "confirmed",
    createdAt: "2026-11-01T12:00:00.000Z",
    items: [],
  }]);
});
