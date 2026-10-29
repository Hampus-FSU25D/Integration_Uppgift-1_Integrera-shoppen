import express from "express";
import multer from "multer";
import {
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  ProductImageValidationError,
  SupabaseStorageError,
  uploadProductImage,
} from "./supabaseStorageAdapter.js";

const parseProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PRODUCT_IMAGE_SIZE_BYTES, files: 1, fields: 0, parts: 1 },
}).single("image");

export function createAdminProductImageRouter({ requireAdmin, uploadImage = uploadProductImage }) {
  const router = express.Router();

  router.post("/", requireAdmin, (request, response, next) => {
    if (request.get("X-Requested-With") !== "XMLHttpRequest") {
      return response.status(403).json({ error: "Förfrågan saknar säkerhetsheader." });
    }
    return next();
  }, (request, response, next) => {
    parseProductImage(request, response, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return response.status(400).json({ error: "Bildfilen får vara högst 5 MiB (5 242 880 byte)." });
      }
      if (error instanceof multer.MulterError) {
        return response.status(400).json({ error: "Skicka en enda bildfil i fältet image." });
      }
      return next(error);
    });
  }, async (request, response, next) => {
    if (!request.file) return response.status(400).json({ error: "Välj en bildfil att ladda upp." });

    try {
      const image = await uploadImage({ data: request.file.buffer, contentType: request.file.mimetype });
      return response.status(201).json(image);
    } catch (error) {
      if (error instanceof ProductImageValidationError) {
        return response.status(error.status).json({ error: error.message });
      }
      if (error instanceof SupabaseStorageError) {
        return response.status(502).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
}
