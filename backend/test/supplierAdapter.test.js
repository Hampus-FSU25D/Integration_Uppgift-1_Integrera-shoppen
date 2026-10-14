import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadProjectEnv } from "../src/load-env.js";
import { fetchSupplierCatalog, SupplierApiError } from "../src/integrations/supplierAdapter.js";

loadProjectEnv();

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.SUPPLIER_API_BASE_URL;
const originalApiKey = process.env.SUPPLIER_API_KEY;
const baseUrl = process.env.SUPPLIER_API_BASE_URL;
const apiKey = process.env.SUPPLIER_API_KEY;

after(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("SUPPLIER_API_BASE_URL", originalBaseUrl);
  restoreEnv("SUPPLIER_API_KEY", originalApiKey);
});

test("fetches CSV and XML from the selected supplier branch", async () => {
  assert.ok(baseUrl, "SUPPLIER_API_BASE_URL must be set in .env");
  assert.ok(apiKey, "SUPPLIER_API_KEY must be set in .env");
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: url.toString(), options });
    return new Response(url.pathname.endsWith(".csv") ? "csv data" : "xml data");
  };

  assert.equal(await fetchSupplierCatalog("csv", "mat"), "csv data");
  assert.equal(await fetchSupplierCatalog("xml", "mat"), "xml data");
  const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, "")}/`;
  assert.deepEqual(requests.map((request) => request.url), [
    new URL("export/products.csv?bransch=mat", normalizedBaseUrl).toString(),
    new URL("export/products.xml?bransch=mat", normalizedBaseUrl).toString(),
  ]);
  for (const { options } of requests) {
    assert.equal(options.method, "GET");
    assert.equal(options.headers["X-Api-Key"], apiKey);
    assert.ok(options.signal);
  }
});

test("reports HTTP and network failures as supplier errors", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(fetchSupplierCatalog("csv", "mat"), (error) => {
    assert.ok(error instanceof SupplierApiError);
    assert.match(error.message, /503/);
    return true;
  });

  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  await assert.rejects(fetchSupplierCatalog("xml", "mat"), (error) => {
    assert.ok(error instanceof SupplierApiError);
    assert.match(error.message, /unavailable.*timed out/i);
    return true;
  });
});

test("decodes the response using the supplier's declared character encoding", async () => {
  globalThis.fetch = async () => new Response(new Uint8Array([0xf6]), {
    headers: { "Content-Type": "text/csv; charset=windows-1252" },
  });

  assert.equal(await fetchSupplierCatalog("csv", "mat"), "ö");
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
