import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createShippingQuoteRouter } from "../src/integrations/shippingQuoteRoutes.js";

const productId = "550e8400-e29b-41d4-a716-446655440000";

test("quotes both shipping methods using database prices, not submitted totals", async () => {
  const queries = [];
  const response = await requestQuote({
    items: [{ productId, quantity: 2 }],
    subtotalPrice: 0,
    shippingPrice: 0,
  }, {
    database: {
      async query(sql, values) {
        queries.push({ sql, values });
        return { rows: [{ id: productId, price: "249.50", stock: 4 }], rowCount: 1 };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    subtotalPrice: 499,
    options: [
      { method: "service-point", price: 59, totalPrice: 558 },
      { method: "home", price: 99, totalPrice: 598 },
    ],
  });
  assert.deepEqual(queries[0].values, [[productId]]);
  assert.match(queries[0].sql, /price, stock/);
});

test("quotes free delivery at the threshold using the merchandise subtotal", async () => {
  const response = await requestQuote({ items: [{ productId, quantity: 2 }] }, {
    database: { async query() { return { rows: [{ id: productId, price: "250.00", stock: 2 }], rowCount: 1 }; } },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).options, [
    { method: "service-point", price: 0, totalPrice: 500 },
    { method: "home", price: 0, totalPrice: 500 },
  ]);
});

test("rejects invalid, unavailable, and out-of-stock items", async () => {
  let queries = 0;
  const invalid = await requestQuote({ items: [{ productId, quantity: 0 }] }, {
    database: { async query() { queries += 1; return { rows: [] }; } },
  });
  assert.equal(invalid.status, 400);
  assert.equal(queries, 0);

  const unavailable = await requestQuote({ items: [{ productId, quantity: 1 }] }, {
    database: { async query() { return { rows: [], rowCount: 0 }; } },
  });
  assert.equal(unavailable.status, 400);

  const insufficientStock = await requestQuote({ items: [{ productId, quantity: 3 }] }, {
    database: { async query() { return { rows: [{ id: productId, price: "10.00", stock: 2 }], rowCount: 1 }; } },
  });
  assert.equal(insufficientStock.status, 400);
});

async function requestQuote(body, { database }) {
  const app = express();
  app.use(express.json());
  app.use("/api/shipping/quote", createShippingQuoteRouter({ database, env: {} }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/shipping/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
