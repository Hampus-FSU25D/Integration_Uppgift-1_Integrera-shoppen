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
        return { rows: [{ inserted: values[4] === "LEV-1001" }] };
      }
      return { rows: [] };
    },
  };
  const rows = [
    { product: { sku: "LEV-1001", name: "Bröd", categoryName: "Mat", price: 20, stock: 2 } },
    { product: { sku: "LEV-1002", name: "Soppa", categoryName: "Mat", price: 30, stock: 0 } },
    { raw: { artNr: "LEV-1037" }, reason: "Price is invalid." },
  ];

  const report = await saveSupplierProducts(rows, client);

  assert.deepEqual(report, {
    created: 1,
    updated: 1,
    skipped: 1,
    skippedProducts: [{ articleNumber: "LEV-1037", reason: "Price is invalid." }],
  });
  assert.equal(queries[0].sql, "begin");
  assert.equal(queries.at(-1).sql, "commit");
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
