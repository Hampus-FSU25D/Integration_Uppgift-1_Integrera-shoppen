import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPostNordDeliveryEstimateRouter } from "../src/integrations/postNordDeliveryEstimateRoutes.js";
import { PostNordApiError } from "../src/integrations/postNordServicePointAdapter.js";

test("returns the estimate for the requested postal code and delivery type", async () => {
  let input;
  const response = await requestEstimate("?postalCode=41104&city=Göteborg&deliveryType=home", {
    async estimate(value) {
      input = value;
      return { deliveryType: "home", days: "2-4", latest: "16:00" };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deliveryType: "home", days: "2-4", latest: "16:00" });
  assert.deepEqual(input, { postalCode: "41104", city: "Göteborg", deliveryType: "home" });
});

test("rejects missing or repeated estimate parameters before calling PostNord", async () => {
  let calls = 0;
  const estimate = async () => { calls += 1; return {}; };
  for (const query of ["", "?postalCode=41104", "?postalCode=41104&deliveryType=home", "?postalCode=41104&city=Göteborg&postalCode=17173&deliveryType=home"]) {
    const response = await requestEstimate(query, { estimate });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /leverans/i);
  }
  assert.equal(calls, 0);
});

test("returns controlled PostNord errors", async () => {
  const response = await requestEstimate("?postalCode=41104&city=Göteborg&deliveryType=home", {
    async estimate() { throw new PostNordApiError("PostNord svarade inte i tid.", { status: 502 }); },
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "PostNord svarade inte i tid." });
});

async function requestEstimate(query, { estimate }) {
  const app = express();
  app.use("/api/shipping/delivery-estimate", createPostNordDeliveryEstimateRouter({ estimate }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/shipping/delivery-estimate${query}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
