import test from "node:test";
import assert from "node:assert/strict";
import { syncProductsToSearch } from "../src/integrations/productSearchSync.js";

test("indexes active products and removes inactive products", async () => {
  const indexed = [];
  const deleted = [];
  const result = await syncProductsToSearch([
    { sku: "ACTIVE-1", isActive: true },
    { sku: "INACTIVE-1", isActive: false },
  ], {
    async indexProducts(products) { indexed.push(...products); },
    async deleteProduct(sku) { deleted.push(sku); },
  });

  assert.deepEqual(result, { updated: true });
  assert.deepEqual(indexed.map(({ sku }) => sku), ["ACTIVE-1"]);
  assert.deepEqual(deleted, ["INACTIVE-1"]);
});

test("removes the old article number if an admin changes a product SKU", async () => {
  const deleted = [];
  await syncProductsToSearch([{ sku: "NEW-1", isActive: true }], {
    async indexProducts() {},
    async deleteProduct(sku) { deleted.push(sku); },
    removedSkus: ["OLD-1"],
  });
  assert.deepEqual(deleted, ["OLD-1"]);
});

test("reports an index outage without throwing after a database save", async () => {
  const result = await syncProductsToSearch([{ sku: "ACTIVE-1", isActive: true }], {
    async indexProducts() { throw new Error("Algolia is unavailable."); },
  });

  assert.deepEqual(result, { updated: false, error: "Algolia is unavailable." });
});
