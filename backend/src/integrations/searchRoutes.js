import express from "express";
import { AlgoliaError, searchProducts } from "./algoliaAdapter.js";
import { parseSearchParams, SearchParameterError } from "./searchParams.js";

export function createSearchRouter({ search = searchProducts, loadCurrentStocks } = {}) {
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
      const result = await search(params.query, params.page, params.pageSize, params.categorySlug, params.sort);
      if (!loadCurrentStocks || result.hits.length === 0) return response.json(result);

      const stockRows = await loadCurrentStocks(result.hits.map((product) => product.id));
      const currentStocks = new Map(stockRows.map((row) => [row.id, row.stock]));
      return response.json({
        ...result,
        hits: result.hits.map((product) => ({
          ...product,
          stock: currentStocks.get(product.id) ?? 0,
        })),
      });
    } catch (error) {
      if (error instanceof AlgoliaError) return response.status(502).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
