import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createAdminProductImageRouter,
} from "../src/integrations/adminProductImageRoutes.js";
import {
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  ProductImageValidationError,
  SupabaseStorageError,
} from "../src/integrations/supabaseStorageAdapter.js";

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const productId = "991e8400-e29b-41d4-a716-446655440001";

test("admin can upload one image and receives only its public metadata", async () => {
  let uploadedImage;
  const queries = [];
  const result = await uploadRequest({
    database: { async query(sql, values) { queries.push({ sql, values }); return { rowCount: 1 }; } },
    uploadImage: async (image) => {
      uploadedImage = image;
      return { path: "products/uuid.png", publicUrl: "https://images.example.com/image.png" };
    },
  });

  assert.equal(result.response.status, 201);
  assert.deepEqual(await result.response.json(), {
    productId,
    path: "products/uuid.png",
    publicUrl: "https://images.example.com/image.png",
  });
  assert.deepEqual(uploadedImage, { data: Buffer.from(pngBytes), contentType: "image/png" });
  assert.deepEqual(queries.map(({ sql }) => sql), [
    "select id from products where id=$1",
    "update products set image_storage_path=$1, image_url=$2, updated_at=now() where id=$3 returning id",
  ]);
  assert.deepEqual(queries[1].values, ["products/uuid.png", "https://images.example.com/image.png", productId]);
});

test("requires an admin session and a custom request header before parsing the upload", async () => {
  let uploadCalls = 0;
  const uploadImage = async () => { uploadCalls += 1; };

  const anonymous = await uploadRequest({ role: null, uploadImage });
  assert.equal(anonymous.response.status, 401);

  const customer = await uploadRequest({ role: "customer", uploadImage });
  assert.equal(customer.response.status, 403);

  const missingRequestHeader = await uploadRequest({ includeRequestHeader: false, uploadImage });
  assert.equal(missingRequestHeader.response.status, 403);
  assert.equal(uploadCalls, 0);
});

test("requires exactly one file and rejects files larger than 5 MiB", async () => {
  let uploadCalls = 0;
  const uploadImage = async () => { uploadCalls += 1; };

  const missingFile = await uploadRequest({ file: false, uploadImage });
  assert.equal(missingFile.response.status, 400);

  const multipleFiles = await uploadRequest({ multipleFiles: true, uploadImage });
  assert.equal(multipleFiles.response.status, 400);

  const oversized = await uploadRequest({
    bytes: new Uint8Array(MAX_PRODUCT_IMAGE_SIZE_BYTES + 1),
    uploadImage,
  });
  assert.equal(oversized.response.status, 400);
  assert.match((await oversized.response.json()).error, /5 MiB/);
  assert.equal(uploadCalls, 0);
});

test("returns controlled validation and Storage errors", async () => {
  const invalidImage = await uploadRequest({
    uploadImage: async () => { throw new ProductImageValidationError("Filen måste vara en JPEG- eller PNG-fil."); },
  });
  assert.equal(invalidImage.response.status, 400);
  assert.match((await invalidImage.response.json()).error, /JPEG- eller PNG/);

  const unavailableStorage = await uploadRequest({
    uploadImage: async () => { throw new SupabaseStorageError("Kunde inte nå Supabase Storage."); },
  });
  assert.equal(unavailableStorage.response.status, 502);
  assert.match((await unavailableStorage.response.json()).error, /Supabase Storage/);
});

test("checks that the product exists before uploading", async () => {
  let uploadCalls = 0;
  const result = await uploadRequest({
    database: { async query() { return { rowCount: 0 }; } },
    uploadImage: async () => { uploadCalls += 1; },
  });

  assert.equal(result.response.status, 404);
  assert.equal(uploadCalls, 0);
});

test("does not update the product image when Storage upload fails", async () => {
  const queries = [];
  const result = await uploadRequest({
    database: { async query(sql) { queries.push(sql); return { rowCount: 1 }; } },
    uploadImage: async () => { throw new SupabaseStorageError("Kunde inte nå Supabase Storage."); },
  });

  assert.equal(result.response.status, 502);
  assert.deepEqual(queries, ["select id from products where id=$1"]);
});

async function uploadRequest({
  role = "admin",
  includeRequestHeader = true,
  file = true,
  multipleFiles = false,
  bytes = pngBytes,
  database = { async query() { return { rowCount: 1 }; } },
  uploadImage,
}) {
  const app = express();
  app.use("/api/admin/products", createAdminProductImageRouter({
    requireAdmin(request, response, next) {
      if (!request.get("x-test-role")) return response.status(401).json({ error: "Login required." });
      if (request.get("x-test-role") !== "admin") return response.status(403).json({ error: "Admin access required." });
      return next();
    },
    database,
    uploadImage,
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const form = new FormData();
    if (file) form.append("image", new Blob([bytes], { type: "image/png" }), "client-name.png");
    if (multipleFiles) form.append("image", new Blob([pngBytes], { type: "image/png" }), "second.png");
    const headers = {};
    if (role) headers["x-test-role"] = role;
    if (includeRequestHeader) headers["x-requested-with"] = "XMLHttpRequest";
    const body = role === "admin" && includeRequestHeader ? form : undefined;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/products/${productId}/image`, {
      method: "POST",
      headers,
      ...(body ? { body } : {}),
    });
    return { response };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
