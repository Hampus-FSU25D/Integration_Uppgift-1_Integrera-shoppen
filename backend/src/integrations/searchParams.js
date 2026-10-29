export function parseSearchParams(params) {
  const query = params.query === undefined ? "" : params.query;
  if (typeof query !== "string" || query.length > 200) {
    throw new SearchParameterError("Search query must be text with at most 200 characters.");
  }

  const categorySlug = params.category === undefined ? null : params.category;
  if (categorySlug !== null && (typeof categorySlug !== "string" || categorySlug.length > 100 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug))) {
    throw new SearchParameterError("category must be a valid category slug.");
  }

  const sort = params.sort === undefined ? "relevance" : params.sort;
  if (sort !== "relevance" && sort !== "price_asc" && sort !== "price_desc") {
    throw new SearchParameterError("sort must be relevance, price_asc, or price_desc.");
  }

  return {
    query: query.trim(),
    page: parsePositiveInteger(params.page, "page", 1),
    pageSize: parsePositiveInteger(params.pageSize, "pageSize", 12, 50),
    categorySlug,
    sort,
  };
}

export class SearchParameterError extends Error {}

function parsePositiveInteger(value, name, defaultValue, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new SearchParameterError(`${name} must be a positive whole number.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new SearchParameterError(name === "pageSize"
      ? `pageSize must be between 1 and ${max}.`
      : "page must be a positive whole number.");
  }
  return number;
}
