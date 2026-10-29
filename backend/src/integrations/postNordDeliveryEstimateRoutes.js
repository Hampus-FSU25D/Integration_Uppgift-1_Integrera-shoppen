import express from "express";
import { getDeliveryEstimate, PostNordApiError } from "./postNordServicePointAdapter.js";

export function createPostNordDeliveryEstimateRouter({ estimate = getDeliveryEstimate } = {}) {
  const router = express.Router();

  router.get("/", async (request, response, next) => {
    const { postalCode, deliveryType } = request.query;
    if (typeof postalCode !== "string" || typeof deliveryType !== "string") {
      return response.status(400).json({ error: "Ange postnummer och leveranssätt för att beräkna leveranstid." });
    }

    try {
      return response.json(await estimate({ postalCode, deliveryType }));
    } catch (error) {
      if (error instanceof PostNordApiError) {
        console.warn("PostNord delivery estimate failed:", error.message, error.providerMessage ?? "");
        return response.status(error.status ?? 502).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
}
