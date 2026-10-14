import assert from "node:assert/strict";
import { test } from "node:test";
import { saveSupplierProducts } from "../src/integrations/supplierImport.js";

test("saves valid products and reports created, updated, and skipped counts", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("insert into categories")) return { rows: [{ id: "category-id" }] };
      if (sql.includes("insert into products")) {
        return { rows: [{ id: `id-${values[4]}`, inserted: values[4] === "LEV-1001" }] };
      }
      if (sql.includes("from products p")) {
        return { rows: [
          { id: "id-LEV-1001", category_id: "category-id", category_name: "Mat", category_slug: "mat", name: "Bröd", price: "20", discount_percentage: "0", rating: null, stock: 2, sku: "LEV-1001", is_active: true },
          { id: "id-LEV-1002", category_id: "category-id", category_name: "Mat", category_slug: "mat", name: "Soppa", price: "30", discount_percentage: "0", rating: null, stock: 0, sku: "LEV-1002", is_active: true },
        ] };
      }
      return { rows: [] };
    },
  };
  const rows = [
    { product: { sku: "LEV-1001", name: "Bröd", categoryName: "Mat", price: 20, stock: 2 } },
    { product: { sku: "LEV-1002", name: "Soppa", categoryName: "Mat", price: 30, stock: 0 } },
    { raw: { artNr: "LEV-1037" }, reason: "Price is invalid." },
  ];

  let indexedProducts;
  const report = await saveSupplierProducts(rows, client, {
    async indexProducts(products) { indexedProducts = products; },
  });

  assert.deepEqual(report, {
    created: 1,
    updated: 1,
    skipped: 1,
    skippedProducts: [{ articleNumber: "LEV-1037", reason: "Price is invalid." }],
    searchIndexUpdated: true,
  });
  assert.equal(indexedProducts.length, 2);
  assert.equal(indexedProducts[0].sku, "LEV-1001");
  assert.equal(indexedProducts[0].price, 20);
  assert.equal(queries[0].sql, "begin");
  const commitIndex = queries.findIndex(({ sql }) => sql === "commit");
  const productRead = queries.find(({ sql }) => sql.includes("from products p")).sql;
  assert.equal(commitIndex < queries.findIndex(({ sql }) => sql === productRead), true);
  assert.doesNotMatch(productRead, /where p\.sku/);
});

test("rolls back product changes when a database write fails", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "begin") return { rows: [] };
      throw new Error("database unavailable");
    },
  };

  await assert.rejects(saveSupplierProducts([
    { product: { sku: "LEV-1001", name: "Bröd", categoryName: "Mat", price: 20, stock: 2 } },
  ], client), /database unavailable/);
  assert.equal(queries.at(-1), "rollback");
});

test("keeps the committed import when search indexing fails and reports it", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push(sql);
      if (sql.includes("insert into categories")) return { rows: [{ id: "category-id" }] };
      if (sql.includes("insert into products")) return { rows: [{ id: "product-id", inserted: true }] };
      if (sql.includes("from products p")) {
        return { rows: [{
          id: "product-id", category_id: "category-id", category_name: "Mat", category_slug: "mat",
          name: "Bröd", price: "20", discount_percentage: "0", rating: null, stock: 2, sku: "LEV-1001", is_active: true,
        }] };
      }
      return { rows: [] };
    },
  };

  const report = await saveSupplierProducts([
    { product: { sku: "LEV-1001", name: "Bröd", categoryName: "Mat", price: 20, stock: 2 } },
  ], client, { async indexProducts() { throw new Error("Algolia is unavailable."); } });

  assert.equal(report.created, 1);
  assert.equal(report.searchIndexUpdated, false);
  assert.match(report.searchIndexError, /Algolia is unavailable/);
  assert.equal(queries.includes("commit"), true);
  assert.equal(queries.includes("rollback"), false);
});
