import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createSearchRouter } from "../src/integrations/searchRoutes.js";

test("forwards a combined text and category search through the search route", async () => {
  let searchArgs;
  const result = { hits: [], totalHits: 0, totalPages: 0, page: 2 };
  const response = await requestSearch("?query=kakao&category=mat&page=2&pageSize=12", {
    async search(...args) {
      searchArgs = args;
      return result;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(searchArgs, ["kakao", 2, 12, "mat", "relevance"]);
});

test("returns HTTP 400 for an invalid category without calling Algolia", async () => {
  let calls = 0;
  const response = await requestSearch("?category=not%20a%20slug", {
    async search() { calls += 1; return {}; },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /category/i);
  assert.equal(calls, 0);
});

test("returns HTTP 400 for an unsupported sort mode without calling Algolia", async () => {
  let calls = 0;
  const response = await requestSearch("?sort=cheap", {
    async search() { calls += 1; return {}; },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /sort/i);
  assert.equal(calls, 0);
});

test("forwards sorting together with a category filter", async () => {
  let searchArgs;
  const response = await requestSearch("?category=mat&sort=price_desc", {
    async search(...args) { searchArgs = args; return { hits: [], totalHits: 0, totalPages: 0, page: 1 }; },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(searchArgs, ["", 1, 12, "mat", "price_desc"]);
});

async function requestSearch(query, { search }) {
  const app = express();
  app.use("/api/search", createSearchRouter({ search }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/search${query}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
