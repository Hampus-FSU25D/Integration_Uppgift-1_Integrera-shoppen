import assert from "node:assert/strict";
import test from "node:test";
import { getDeliveryEstimate, PostNordApiError } from "../src/integrations/postNordServicePointAdapter.js";

const env = {
  POSTNORD_API_KEY: "sandbox-secret",
  POSTNORD_API_BASE_URL: "https://atapi2.postnord.com",
  POSTNORD_CUSTOMER_KEY: "shop-test-customer",
  POSTNORD_ORIGIN_POSTAL_CODE: "171 73",
};

test("requests PostNord's interval for the selected delivery type", async () => {
  let request;
  const estimate = await getDeliveryEstimate({ postalCode: "411 04", deliveryType: "service-point" }, {
    env,
    now: () => new Date("2026-10-29T09:30:00.000Z"),
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options, body: JSON.parse(options.body) };
      return Response.json(deliveryOptions);
    },
  });

  assert.equal(request.url.origin, "https://atapi2.postnord.com");
  assert.equal(request.url.pathname, "/rest/shipment/v1/deliveryoptions/bywarehouse");
  assert.deepEqual(Object.fromEntries(request.url.searchParams), { apikey: "sandbox-secret" });
  assert.equal(request.options.method, "POST");
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(request.body, {
    warehouses: [{
      id: "shop",
      address: { postCode: "17173", countryCode: "SE" },
      orderHandling: { handOverTimer: "2026-10-29T09:30:00.000Z" },
    }],
    customer: { customerKey: "shop-test-customer" },
    recipient: { address: { postCode: "41104", countryCode: "SE" } },
  });
  assert.deepEqual(estimate, { deliveryType: "service-point", days: "1-3", latest: "15:00" });
  assert.equal(JSON.stringify(estimate).includes("sandbox-secret"), false);
});

test("rejects invalid delivery request values and missing PostNord configuration", async () => {
  let requested = false;
  await assert.rejects(getDeliveryEstimate({ postalCode: "1234", deliveryType: "home" }, {
    env,
    fetchImpl: async () => { requested = true; throw new Error("unexpected request"); },
  }), (error) => error instanceof PostNordApiError && /postnummer/i.test(error.message));
  await assert.rejects(getDeliveryEstimate({ postalCode: "12345", deliveryType: "locker" }, { env }),
    (error) => error instanceof PostNordApiError && /fraktsätt/i.test(error.message));
  await assert.rejects(getDeliveryEstimate({ postalCode: "12345", deliveryType: "home" }, {
    env: { ...env, POSTNORD_CUSTOMER_KEY: undefined },
    fetchImpl: async () => { requested = true; throw new Error("unexpected request"); },
  }), (error) => error instanceof PostNordApiError && /konfigurer/i.test(error.message));
  assert.equal(requested, false);
});

test("rejects malformed responses or a missing option for the requested method", async () => {
  for (const payload of [
    {},
    { warehouseToDeliveryOptions: {} },
    { warehouseToDeliveryOptions: [{ deliveryOptions: [] }] },
    { warehouseToDeliveryOptions: [{ deliveryOptions: [{ type: "service-point", defaultOption: {} }] }] },
  ]) {
    await assert.rejects(getDeliveryEstimate({ postalCode: "41104", deliveryType: "service-point" }, {
      env,
      fetchImpl: async () => Response.json(payload),
    }), (error) => error instanceof PostNordApiError && /leveransalternativ/i.test(error.message));
  }
});

test("returns controlled errors for PostNord failures and timeouts", async () => {
  await assert.rejects(getDeliveryEstimate({ postalCode: "41104", deliveryType: "home" }, {
    env,
    fetchImpl: async () => new Response(null, { status: 503 }),
  }), (error) => error instanceof PostNordApiError && /503/.test(error.message));

  await assert.rejects(getDeliveryEstimate({ postalCode: "41104", deliveryType: "home" }, {
    env,
    fetchImpl: async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
  }), (error) => error instanceof PostNordApiError && /svarade inte i tid/i.test(error.message));
});

const deliveryOptions = {
  warehouseToDeliveryOptions: [{
    deliveryOptions: [
      {
        type: "home",
        defaultOption: { deliveryTime: { dayRange: { days: "2-4", latest: "16:00" } } },
      },
      {
        type: "service-point",
        defaultOption: { deliveryTime: { dayRange: { days: "1-3", latest: "15:00" } } },
      },
    ],
  }],
};
