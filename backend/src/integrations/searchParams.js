export function parseSearchParams(params) {
  const query = params.query === undefined ? "" : params.query;
  if (typeof query !== "string" || query.length > 200) {
    throw new SearchParameterError("Search query must be text with at most 200 characters.");
  }

  return {
    query: query.trim(),
    page: parsePositiveInteger(params.page, "page", 1),
    pageSize: parsePositiveInteger(params.pageSize, "pageSize", 12, 50),
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
