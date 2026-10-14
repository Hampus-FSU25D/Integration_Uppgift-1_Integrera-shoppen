import test from "node:test";
import assert from "node:assert/strict";
import { deleteProductFromSearch, indexProducts, replaceAllProducts, searchProducts } from "../src/integrations/algoliaAdapter.js";

const originalEnv = { ...process.env };

test.beforeEach(() => {
  process.env.ALGOLIA_APP_ID = "test-app";
  process.env.ALGOLIA_ADMIN_API_KEY = "write-test-key";
  process.env.ALGOLIA_SEARCH_API_KEY = "search-test-key";
  process.env.ALGOLIA_INDEX_NAME = "shop_products";
});

test.afterEach(() => {
  process.env = { ...originalEnv };
  delete globalThis.fetch;
});

test("indexes products using SKU as Algolia objectID and the write key", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ taskID: 42, objectIDs: ["LEV-1"] });
  };

  await indexProducts([product]);

  assert.equal(request.url, "https://test-app.algolia.net/1/indexes/shop_products/batch");
  assert.equal(request.options.headers["X-Algolia-API-Key"], "write-test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    requests: [{ action: "addObject", body: { ...product, objectID: "LEV-1" } }],
  });
});

test("tries Algolia's alternate cluster hosts when the primary host cannot be reached", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (urls.length === 1) throw new TypeError("fetch failed");
    return Response.json({ taskID: 42, objectIDs: ["LEV-1"] });
  };

  await indexProducts([product]);

  assert.equal(urls.length, 2);
  assert.match(urls[1], /^https:\/\/test-app-1\.algolianet\.com\//);
});

test("searches with the search key and validates the response before mapping", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ hits: [{ ...product, objectID: "LEV-1" }], nbHits: 21, nbPages: 2, page: 1 });
  };

  const result = await searchProducts("kakao", 2, 12);

  assert.equal(request.url, "https://test-app-dsn.algolia.net/1/indexes/shop_products/query");
  assert.equal(request.options.headers["X-Algolia-API-Key"], "search-test-key");
  assert.deepEqual(JSON.parse(request.options.body), { query: "kakao", page: 1, hitsPerPage: 12 });
  assert.deepEqual(result, { hits: [product], totalHits: 21, totalPages: 2, page: 2 });
});

test("deletes a product by its article number", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ taskID: 12 });
  };

  await deleteProductFromSearch("LEV-1");

  assert.equal(request.url, "https://test-app.algolia.net/1/indexes/shop_products/LEV-1");
  assert.equal(request.options.method, "DELETE");
  assert.equal(request.options.headers["X-Algolia-API-Key"], "write-test-key");
});

test("clears the index then replaces its contents with active database products", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/clear") || url.endsWith("/batch")) {
      return Response.json({ taskID: url.endsWith("/clear") ? 1 : 2 });
    }
    return Response.json({ status: "published" });
  };

  await replaceAllProducts([product, { ...product, sku: "INACTIVE-1", isActive: false }]);

  assert.equal(requests[0].url, "https://test-app.algolia.net/1/indexes/shop_products/clear");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[1].url, "https://test-app.algolia.net/1/indexes/shop_products/task/1");
  assert.equal(requests[2].url, "https://test-app.algolia.net/1/indexes/shop_products/batch");
  assert.deepEqual(JSON.parse(requests[2].options.body).requests, [
    { action: "addObject", body: { ...product, objectID: "LEV-1" } },
  ]);
  assert.equal(requests[3].url, "https://test-app.algolia.net/1/indexes/shop_products/task/2");
});

test("reports missing credentials without making a request", async () => {
  delete process.env.ALGOLIA_ADMIN_API_KEY;
  globalThis.fetch = async () => assert.fail("fetch should not run");

  await assert.rejects(indexProducts([product]), /Algolia credentials are not configured/);
});

test("turns provider errors and malformed search data into controlled errors", async () => {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(searchProducts("tea", 1, 12), /Algolia request failed/);

  globalThis.fetch = async () => Response.json({ hits: [{ objectID: "broken" }], nbHits: 1, nbPages: 1, page: 0 });
  await assert.rejects(searchProducts("tea", 1, 12), /Algolia returned an invalid search result/);
});

const product = {
  id: "product-uuid",
  externalId: null,
  categoryId: "category-uuid",
  categoryName: "Mat",
  categorySlug: "mat",
  name: "Kakao",
  description: null,
  price: 25,
  discountPercentage: 0,
  rating: null,
  stock: 4,
  brand: null,
  sku: "LEV-1",
  imageUrl: null,
  isActive: true,
};
