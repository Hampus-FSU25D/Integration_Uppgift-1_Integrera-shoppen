import express from "express";
import { AlgoliaError, searchProducts } from "./algoliaAdapter.js";
import { parseSearchParams, SearchParameterError } from "./searchParams.js";

export function createSearchRouter({ search = searchProducts } = {}) {
  const router = express.Router();

  router.get("/", async (request, response, next) => {
    let params;
    try {
      params = parseSearchParams(request.query);
    } catch (error) {
      if (error instanceof SearchParameterError) return response.status(400).json({ error: error.message });
      return next(error);
    }

    try {
      return response.json(await search(params.query, params.page, params.pageSize, params.categorySlug, params.sort));
    } catch (error) {
      if (error instanceof AlgoliaError) return response.status(502).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
