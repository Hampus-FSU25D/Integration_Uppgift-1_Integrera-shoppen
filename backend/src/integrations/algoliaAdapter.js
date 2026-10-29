const timeoutMs = 8_000;

export async function indexProducts(products) {
  if (products.length === 0) return;
  const config = getConfig("write");
  await sendProducts(config, products);
}

async function sendProducts(config, products) {
  const requests = products.map((product) => ({
    action: "addObject",
    body: { ...product, objectID: product.sku },
  }));

  return request(config, `/1/indexes/${encodeURIComponent(config.indexName)}/batch`, {
    method: "POST",
    apiKey: config.adminApiKey,
    body: { requests },
  });
}

export async function replaceAllProducts(products) {
  const config = getConfig("write");
  const clearTask = await request(config, `/1/indexes/${encodeURIComponent(config.indexName)}/clear`, {
    method: "POST",
    apiKey: config.adminApiKey,
  });
  await waitForTask(config, clearTask.taskID);
  const activeProducts = products.filter((product) => product.isActive);
  if (activeProducts.length === 0) return;
  const indexTask = await sendProducts(config, activeProducts);
  await waitForTask(config, indexTask.taskID);
}

async function waitForTask(config, taskID) {
  if (!Number.isInteger(taskID)) throw new AlgoliaError("Algolia returned an invalid task response.");
  const path = `/1/indexes/${encodeURIComponent(config.indexName)}/task/${taskID}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await request(config, path, { method: "GET", apiKey: config.adminApiKey });
    if (result.status === "published") return;
    if (result.status !== "notPublished") throw new AlgoliaError("Algolia returned an invalid task status.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new AlgoliaError("Timed out while waiting for Algolia to update the index.");
}

export async function deleteProductFromSearch(sku) {
  const config = getConfig("write");
  await request(config, `/1/indexes/${encodeURIComponent(config.indexName)}/${encodeURIComponent(sku)}`, {
    method: "DELETE",
    apiKey: config.adminApiKey,
  });
}

export async function searchProducts(query, page, pageSize, categorySlug = null, sort = "relevance") {
  const config = getConfig("search");
  const searchParams = { query, page: page - 1, hitsPerPage: pageSize };
  if (categorySlug) searchParams.filters = `categorySlug:${categorySlug}`;
  const indexName = sort === "relevance" ? config.indexName : `${config.indexName}_${sort}`;
  const response = await request(config, `/1/indexes/${encodeURIComponent(indexName)}/query`, {
    method: "POST",
    apiKey: config.searchApiKey,
    host: `${config.appId}-dsn.algolia.net`,
    body: searchParams,
  });

  if (!isSearchResponse(response)) throw new AlgoliaError("Algolia returned an invalid search result.");
  return {
    hits: response.hits.map(({ objectID: _objectID, ...product }) => product),
    totalHits: response.nbHits,
    totalPages: response.nbPages,
    page,
  };
}

export class AlgoliaError extends Error {}

function getConfig(mode) {
  const { ALGOLIA_APP_ID: appId, ALGOLIA_INDEX_NAME: indexName = "products" } = process.env;
  const apiKey = mode === "write" ? process.env.ALGOLIA_ADMIN_API_KEY : process.env.ALGOLIA_SEARCH_API_KEY;
  if (!appId || !apiKey || !indexName) {
    throw new AlgoliaError("Algolia credentials are not configured. Set the Algolia variables in the server environment.");
  }
  return {
    appId,
    indexName,
    adminApiKey: process.env.ALGOLIA_ADMIN_API_KEY,
    searchApiKey: process.env.ALGOLIA_SEARCH_API_KEY,
  };
}

async function request(config, path, { method, apiKey, host = `${config.appId}.algolia.net`, body }) {
  const hosts = [host, ...[1, 2, 3].map((number) => `${config.appId}-${number}.algolianet.com`)];
  let response;
  for (const candidate of hosts) {
    try {
      response = await fetch(`https://${candidate}${path}`, {
        method,
        headers: {
          "X-Algolia-API-Key": apiKey,
          "X-Algolia-Application-Id": config.appId,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      break;
    } catch {
      // Algolia's client uses these cluster hosts when the primary API host is unreachable.
    }
  }

  if (!response) throw new AlgoliaError("Algolia could not be reached. Try again later.");

  if (!response.ok) throw new AlgoliaError(`Algolia request failed with status ${response.status}.`);
  if (response.status === 204) return {};
  try {
    return await response.json();
  } catch {
    throw new AlgoliaError("Algolia returned an invalid response.");
  }
}

function isSearchResponse(value) {
  return value && Array.isArray(value.hits) && Number.isInteger(value.nbHits) && value.nbHits >= 0 &&
    Number.isInteger(value.nbPages) && value.nbPages >= 0 && Number.isInteger(value.page) &&
    value.hits.every(isProductHit);
}

function isProductHit(value) {
  return value && typeof value.id === "string" && typeof value.sku === "string" &&
    typeof value.name === "string" && typeof value.price === "number" &&
    typeof value.stock === "number" && typeof value.isActive === "boolean" &&
    (value.categoryId === null || typeof value.categoryId === "string") &&
    (value.categoryName === null || typeof value.categoryName === "string") &&
    (value.categorySlug === null || typeof value.categorySlug === "string") &&
    (value.description === null || typeof value.description === "string") &&
    (value.brand === null || typeof value.brand === "string") &&
    (value.imageUrl === null || typeof value.imageUrl === "string") &&
    (value.externalId === null || typeof value.externalId === "number") &&
    (value.discountPercentage === null || typeof value.discountPercentage === "number") &&
    (value.rating === null || typeof value.rating === "number");
}
