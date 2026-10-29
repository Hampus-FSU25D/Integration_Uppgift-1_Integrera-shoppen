import assert from "node:assert/strict";
import test from "node:test";
import { getNearbyServicePoints, PostNordApiError } from "../src/integrations/postNordServicePointAdapter.js";

const env = {
  POSTNORD_API_KEY: "sandbox-secret",
  POSTNORD_API_BASE_URL: "https://atapi2.postnord.com",
};

test("normalizes Swedish postal codes and maps nearby service points", async () => {
  let request;
  const result = await getNearbyServicePoints("  123 45 ", {
    env,
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return Response.json({ servicePointInformationResponse: { servicePoints: [servicePoint] } });
    },
  });

  assert.equal(request.url.origin, "https://atapi2.postnord.com");
  assert.equal(request.url.pathname, "/rest/businesslocation/v5/servicepoints/nearest/byaddress");
  assert.deepEqual(Object.fromEntries(request.url.searchParams), {
    apikey: "sandbox-secret",
    returnType: "json",
    countryCode: "SE",
    agreementCountry: "SE",
    postalCode: "12345",
    numberOfServicePoints: "10",
    context: "optionalservicepoint",
    responseFilter: "public",
    typeId: "24,25,54",
  });
  assert.equal(request.options.method, "GET");
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(result, [{
    id: "456789",
    countryCode: "SE",
    name: "Postombud City",
    address: "Storgatan 2",
    postalCode: "123 45",
    city: "STADEN",
  }]);
  assert.equal(JSON.stringify(result).includes("sandbox-secret"), false);
});

test("rejects malformed Swedish postal codes before making a request", async () => {
  let requested = false;
  for (const postalCode of ["1234", "123456", "12 345", "abcde"]) {
    await assert.rejects(getNearbyServicePoints(postalCode, {
      env,
      fetchImpl: async () => { requested = true; throw new Error("fetch should not run"); },
    }), (error) => error instanceof PostNordApiError && /postnummer/i.test(error.message));
  }
  assert.equal(requested, false);
});

test("rejects malformed PostNord responses instead of returning partial data", async () => {
  for (const payload of [
    {},
    { servicePointInformationResponse: { servicePoints: {} } },
    { servicePointInformationResponse: { servicePoints: [{ ...servicePoint, servicePointId: null }] } },
    { servicePointInformationResponse: { servicePoints: [{ ...servicePoint, visitingAddress: null }] } },
  ]) {
    await assert.rejects(getNearbyServicePoints("12345", {
      env,
      fetchImpl: async () => Response.json(payload),
    }), (error) => error instanceof PostNordApiError && /ogiltigt svar/i.test(error.message));
  }
});

test("returns controlled errors for missing credentials, HTTP failures, and timeouts", async () => {
  await assert.rejects(getNearbyServicePoints("12345", {
    env: { POSTNORD_API_BASE_URL: env.POSTNORD_API_BASE_URL },
    fetchImpl: async () => assert.fail("fetch should not run without an API key"),
  }), (error) => error instanceof PostNordApiError && /konfigurer/i.test(error.message));

  await assert.rejects(getNearbyServicePoints("12345", {
    env,
    fetchImpl: async () => new Response(null, { status: 429 }),
  }), (error) => error instanceof PostNordApiError && /429/.test(error.message) && !error.message.includes("sandbox-secret"));

  await assert.rejects(getNearbyServicePoints("12345", {
    env,
    fetchImpl: async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
  }), (error) => error instanceof PostNordApiError && /svarade inte i tid/i.test(error.message));
});

test("rejects an invalid PostNord base URL without exposing the API key", async () => {
  await assert.rejects(getNearbyServicePoints("12345", {
    env: { ...env, POSTNORD_API_BASE_URL: "not-a-url" },
    fetchImpl: async () => assert.fail("fetch should not run with an invalid base URL"),
  }), (error) => error instanceof PostNordApiError && !error.message.includes("sandbox-secret"));
});

const servicePoint = {
  name: "Postombud City",
  servicePointId: "456789",
  visitingAddress: {
    countryCode: "SE",
    city: "STADEN",
    streetName: "Storgatan",
    streetNumber: "2",
    postalCode: "123 45",
  },
  type: { groupTypeId: 1, groupTypeName: "Service agent" },
};
