import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSupplierProduct } from "../src/integrations/supplierProduct.js";

const validRow = {
  artNr: "LEV-1001",
  ean: "0735105543300",
  benamning: "Surdegsbröd Klassisk",
  kategori: "Bröd",
  pris: "59,00",
  lagersaldo: "",
  varianter: ["Helt", "Skivat"],
};

test("maps supplier values to the shop product fields", () => {
  assert.deepEqual(mapSupplierProduct(validRow), {
    product: {
      sku: "LEV-1001",
      name: "Surdegsbröd Klassisk",
      categoryName: "Bröd",
      price: 59,
      stock: 0,
    },
    reason: null,
  });
});

test("rejects an invalid supplier price with a useful reason", () => {
  const result = mapSupplierProduct({ ...validRow, artNr: "LEV-1037", pris: "ej satt" });

  assert.equal(result.product, null);
  assert.equal(result.reason, "Price must be a non-negative number with at most two decimals.");
});

test("rejects stock values that are not non-negative whole numbers", () => {
  const result = mapSupplierProduct({ ...validRow, lagersaldo: "2,5" });

  assert.equal(result.product, null);
  assert.equal(result.reason, "Stock must be empty or a non-negative whole number.");
});

test("rejects stock values outside the safe integer range", () => {
  const result = mapSupplierProduct({ ...validRow, lagersaldo: "99999999999999999999" });

  assert.equal(result.product, null);
  assert.equal(result.reason, "Stock must be empty or a non-negative whole number.");
});

test("rejects XML prices that declare a non-SEK currency", () => {
  const result = mapSupplierProduct({ ...validRow, valuta: "EUR" });

  assert.equal(result.product, null);
  assert.equal(result.reason, "Price currency must be SEK.");
});
