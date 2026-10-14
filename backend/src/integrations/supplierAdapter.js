const catalogPaths = {
  csv: "export/products.csv",
  xml: "export/products.xml",
};

const requestTimeoutMs = 10_000;

export class SupplierApiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SupplierApiError";
    this.status = options.status;
  }
}

export async function fetchSupplierCatalog(format, branch) {
  const path = catalogPaths[format];
  if (!path) {
    throw new SupplierApiError("Supplier catalog format must be csv or xml.");
  }
  if (typeof branch !== "string" || !branch.trim()) {
    throw new SupplierApiError("A supplier branch is required.");
  }

  const baseUrl = process.env.SUPPLIER_API_BASE_URL;
  const apiKey = process.env.SUPPLIER_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new SupplierApiError("Supplier API configuration is missing.");
  }

  let url;
  try {
    url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
  } catch (error) {
    throw new SupplierApiError("Supplier API base URL is invalid.", { cause: error });
  }
  url.searchParams.set("bransch", branch.trim());

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new SupplierApiError("Supplier service is unavailable or the request timed out.", { cause: error });
  }

  if (!response.ok) {
    throw new SupplierApiError(`Supplier API request failed with status ${response.status}.`, {
      status: response.status,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(await response.arrayBuffer());
  } catch (error) {
    throw new SupplierApiError("Supplier response could not be decoded.", { cause: error });
  }
}
