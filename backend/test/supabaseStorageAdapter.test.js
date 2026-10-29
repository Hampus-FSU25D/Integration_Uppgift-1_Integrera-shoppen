import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStorageError, uploadProductImage } from "../src/integrations/supabaseStorageAdapter.js";

const env = {
  SUPABASE_URL: "http://192.168.1.183:13080",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  SUPABASE_STORAGE_BUCKET: "product-images",
  SUPABASE_PUBLIC_URL: "https://images.example.com",
};

test("uploads to the configured bucket without overwriting and returns the object path and public URL", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 200 });
  };

  const first = await uploadProductImage({ data: Buffer.from("image"), contentType: "image/jpeg" }, { env, fetchImpl });
  const second = await uploadProductImage({ data: Buffer.from("image"), contentType: "image/png" }, { env, fetchImpl });

  assert.match(first.path, /^products\/[0-9a-f-]+\.jpg$/);
  assert.match(second.path, /^products\/[0-9a-f-]+\.png$/);
  assert.notEqual(first.path, second.path);
  assert.equal(first.publicUrl, `https://images.example.com/storage/v1/object/public/product-images/${first.path}`);
  assert.equal(requests[0].url, `http://192.168.1.183:13080/storage/v1/object/product-images/${first.path}`);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["x-upsert"], "false");
  assert.equal(requests[0].options.headers["Content-Type"], "image/jpeg");
  assert.equal(requests[0].options.headers.Authorization, "Bearer server-only-test-key");
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test("returns a controlled error for service failures and timeouts", async () => {
  await assert.rejects(
    uploadProductImage({ data: Buffer.from("image"), contentType: "image/png" }, {
      env,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    (error) => error instanceof SupabaseStorageError && /HTTP 503/.test(error.message),
  );

  await assert.rejects(
    uploadProductImage({ data: Buffer.from("image"), contentType: "image/png" }, {
      env,
      fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); },
    }),
    (error) => error instanceof SupabaseStorageError && /svarade inte i tid/.test(error.message),
  );
});

test("reports missing configuration and unsupported image formats clearly", async () => {
  await assert.rejects(
    uploadProductImage({ data: Buffer.from("image"), contentType: "image/png" }, { env: {} }),
    /Supabase Storage är inte konfigurerat/,
  );

  await assert.rejects(
    uploadProductImage({ data: Buffer.from("image"), contentType: "image/gif" }, { env }),
    /JPEG- eller PNG/,
  );

  await assert.rejects(
    uploadProductImage({ data: Buffer.from("image"), contentType: "image/png" }, {
      env: { ...env, NODE_ENV: "production", SUPABASE_PUBLIC_URL: "http://images.example.com" },
    }),
    /Produktionsadressen måste använda HTTPS/,
  );
});
