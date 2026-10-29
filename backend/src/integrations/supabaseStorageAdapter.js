import { randomUUID } from "node:crypto";

const requestTimeoutMs = 10_000;
const imageExtensions = { "image/jpeg": "jpg", "image/png": "png" };

export class SupabaseStorageError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SupabaseStorageError";
  }
}

export async function uploadProductImage(image, { env = process.env, fetchImpl = fetch } = {}) {
  const config = getConfig(env);
  const extension = Object.hasOwn(imageExtensions, image.contentType) ? imageExtensions[image.contentType] : undefined;
  if (!extension) {
    throw new SupabaseStorageError("Produktbilden måste vara en JPEG- eller PNG-fil.");
  }

  const path = `products/${randomUUID()}.${extension}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const encodedBucket = encodeURIComponent(config.bucket);

  let response;
  try {
    response = await fetchImpl(`${config.storageUrl}/storage/v1/object/${encodedBucket}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": image.contentType,
        "x-upsert": "false",
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

function getConfig(env) {
  const storageUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const publicUrl = env.SUPABASE_PUBLIC_URL?.replace(/\/+$/, "");

  if (!storageUrl || !serviceRoleKey || !bucket || !publicUrl) {
    throw new SupabaseStorageError(
      "Supabase Storage är inte konfigurerat. Ange SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET och SUPABASE_PUBLIC_URL på backend.",
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

  return { storageUrl, serviceRoleKey, bucket, publicUrl };
}
