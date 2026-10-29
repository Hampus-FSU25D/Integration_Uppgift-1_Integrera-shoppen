import { randomUUID } from "node:crypto";

const requestTimeoutMs = 10_000;
const imageExtensions = { "image/jpeg": "jpg", "image/png": "png" };
const imageSignatures = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export class ProductImageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductImageValidationError";
    this.status = 400;
  }
}

export class SupabaseStorageError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SupabaseStorageError";
  }
}

export async function uploadProductImage(image, { env = process.env, fetchImpl = fetch } = {}) {
  const extension = validateProductImage(image);
  const config = getConfig(env);

  const path = `products/${randomUUID()}.${extension}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const encodedBucket = encodeURIComponent(config.bucket);

  let response;
  try {
    response = await fetchImpl(`${config.storageUrl}/storage/v1/object/${encodedBucket}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: config.apiKey,
        "Content-Type": image.contentType,
        "x-upsert": "false",
        ...(config.useLegacyBearer ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: image.data,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "Supabase Storage svarade inte i tid. Försök igen."
      : "Kunde inte nå Supabase Storage. Försök igen senare.";
    throw new SupabaseStorageError(message, { cause: error });
  }

  if (!response.ok) {
    const detail = response.status === 409 || response.status === 400
      ? `Supabase Storage kunde inte skapa objektet (HTTP ${response.status}); befintliga objekt skrivs inte över.`
      : `Supabase Storage avvisade uppladdningen (HTTP ${response.status}).`;
    throw new SupabaseStorageError(detail, { status: response.status });
  }

  return {
    path,
    publicUrl: `${config.publicUrl}/storage/v1/object/public/${encodedBucket}/${encodedPath}`,
  };
}

function validateProductImage(image) {
  if (!image || !(image.data instanceof Uint8Array)) {
    throw new ProductImageValidationError("Ingen giltig bildfil skickades.");
  }

  if (!Object.hasOwn(imageExtensions, image.contentType)) {
    throw new ProductImageValidationError("Filen måste vara en JPEG- eller PNG-fil.");
  }

  if (image.data.byteLength > MAX_PRODUCT_IMAGE_SIZE_BYTES) {
    throw new ProductImageValidationError("Filen får vara högst 5 MiB (5 242 880 byte).");
  }

  const signature = imageSignatures[image.contentType];
  const matchesSignature = signature.every((byte, index) => image.data[index] === byte);
  if (!matchesSignature) {
    throw new ProductImageValidationError("Filinnehållet stämmer inte med JPEG- eller PNG-formatet.");
  }

  return imageExtensions[image.contentType];
}

function getConfig(env) {
  const storageUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const secretKey = env.SUPABASE_SECRET_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const publicUrl = env.SUPABASE_PUBLIC_URL?.replace(/\/+$/, "");

  if (!storageUrl || (!secretKey && !serviceRoleKey) || !bucket || !publicUrl) {
    throw new SupabaseStorageError(
      "Supabase Storage är inte konfigurerat. Ange SUPABASE_URL, SUPABASE_SECRET_KEY (eller äldre SUPABASE_SERVICE_ROLE_KEY), SUPABASE_STORAGE_BUCKET och SUPABASE_PUBLIC_URL på backend.",
    );
  }

  try {
    for (const [index, value] of [storageUrl, publicUrl].entries()) {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Invalid URL");
      }
      if (index === 1 && env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error("Production public URL must use HTTPS");
      }
    }
  } catch (error) {
    throw new SupabaseStorageError(
      "Supabase Storage-adresserna måste vara giltiga HTTP- eller HTTPS-adresser. Produktionsadressen måste använda HTTPS.",
      { cause: error },
    );
  }

  return { storageUrl, apiKey: secretKey || serviceRoleKey, useLegacyBearer: !secretKey, bucket, publicUrl };
}
