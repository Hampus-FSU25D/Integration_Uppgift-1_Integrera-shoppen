import assert from "node:assert/strict";
import test from "node:test";
import { calculateShippingOptions, priceToMinorUnits } from "../src/integrations/shippingPricing.js";

test("calculates both configured shipping prices below the free-shipping threshold", () => {
  assert.deepEqual(calculateShippingOptions(49_999), [
    { method: "service-point", price: 59 },
    { method: "home", price: 99 },
  ]);
});

test("makes both shipping methods free at and above the merchandise threshold", () => {
  assert.deepEqual(calculateShippingOptions(50_000), [
    { method: "service-point", price: 0 },
    { method: "home", price: 0 },
  ]);
  assert.deepEqual(calculateShippingOptions(50_001).map((option) => option.price), [0, 0]);
});

test("uses integer minor units for decimal database prices", () => {
  assert.equal(priceToMinorUnits("12.34"), 1234);
  assert.equal(priceToMinorUnits("0.1"), 10);
  assert.equal(priceToMinorUnits("12.345"), null);
});

test("uses valid configured shipping amounts and rejects invalid prices", () => {
  assert.deepEqual(calculateShippingOptions(10_000, {
    SHIPPING_SERVICE_POINT_PRICE_SEK: "35",
    SHIPPING_HOME_PRICE_SEK: "75",
    SHIPPING_FREE_THRESHOLD_SEK: "400",
  }), [
    { method: "service-point", price: 35 },
    { method: "home", price: 75 },
  ]);
  assert.throws(() => calculateShippingOptions(10_000, { SHIPPING_HOME_PRICE_SEK: "75.50" }), /Fraktpriser/);
});
