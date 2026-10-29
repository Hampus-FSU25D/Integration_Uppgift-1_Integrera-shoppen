import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPostNordServicePointRouter } from "../src/integrations/postNordServicePointRoutes.js";
import { PostNordApiError } from "../src/integrations/postNordServicePointAdapter.js";

test("returns service points for the requested postal code", async () => {
  let lookedUpPostalCode;
  const points = [{ id: "456789", countryCode: "SE", name: "Postombud City" }];
  const response = await requestServicePoints("?postalCode=12345", {
    async lookup(postalCode) {
      lookedUpPostalCode = postalCode;
      return points;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), points);
  assert.equal(lookedUpPostalCode, "12345");
});

test("rejects missing or repeated postalCode parameters", async () => {
  let calls = 0;
  const lookup = async () => { calls += 1; return []; };

  for (const query of ["", "?postalCode=12345&postalCode=54321"]) {
    const response = await requestServicePoints(query, { lookup });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /postnummer/i);
  }
  assert.equal(calls, 0);
});

test("returns PostNord validation and service errors with controlled statuses", async () => {
  const invalidPostalCode = await requestServicePoints("?postalCode=1234", {
    async lookup() { throw new PostNordApiError("Ange ett giltigt svenskt postnummer.", { status: 400 }); },
  });
  assert.equal(invalidPostalCode.status, 400);
  assert.deepEqual(await invalidPostalCode.json(), { error: "Ange ett giltigt svenskt postnummer." });

  const unavailable = await requestServicePoints("?postalCode=12345", {
    async lookup() { throw new PostNordApiError("PostNord svarade inte i tid.", { status: 502 }); },
  });
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { error: "PostNord svarade inte i tid." });
});

async function requestServicePoints(query, { lookup }) {
  const app = express();
  app.use("/api/shipping/service-points", createPostNordServicePointRouter({ lookup }));
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/shipping/service-points${query}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
