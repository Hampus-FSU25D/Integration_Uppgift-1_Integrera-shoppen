import express from "express";
import { getNearbyServicePoints, PostNordApiError } from "./postNordServicePointAdapter.js";

export function createPostNordServicePointRouter({ lookup = getNearbyServicePoints } = {}) {
  const router = express.Router();

  router.get("/", async (request, response, next) => {
    const postalCode = request.query.postalCode;
    if (typeof postalCode !== "string") {
      return response.status(400).json({ error: "Ange ett giltigt svenskt postnummer." });
    }

    try {
      return response.json(await lookup(postalCode));
    } catch (error) {
      if (error instanceof PostNordApiError) {
        return response.status(error.status ?? 502).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
}
