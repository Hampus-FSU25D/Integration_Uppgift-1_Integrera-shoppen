import express from "express";
import multer from "multer";
import {
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  ProductImageValidationError,
  SupabaseStorageError,
  deleteProductImage,
  uploadProductImage,
} from "./supabaseStorageAdapter.js";

const parseProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PRODUCT_IMAGE_SIZE_BYTES, files: 1, fields: 0, parts: 1 },
}).single("image");

export function createAdminProductImageRouter({
  requireAdmin,
  database,
  uploadImage = uploadProductImage,
  deleteImage = deleteProductImage,
  syncProduct,
}) {
  const router = express.Router();

  router.post("/:productId/image", requireAdmin, (request, response, next) => {
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
    if (!isUuid(request.params.productId)) return response.status(400).json({ error: "Produktens ID är ogiltigt." });

    try {
      const product = await database.query("select id,image_storage_path from products where id=$1", [request.params.productId]);
      if (!product.rowCount) return response.status(404).json({ error: "Produkten hittades inte." });

      const image = await uploadImage({ data: request.file.buffer, contentType: request.file.mimetype });
      let result;
      try {
        result = await database.query(
          "update products set image_storage_path=$1, image_url=$2, updated_at=now() where id=$3 returning id",
          [image.path, image.publicUrl, request.params.productId],
        );
      } catch (error) {
        try {
          await deleteImage(image.path);
        } catch {
          // The database still points to the old image; the uploaded object is orphaned.
        }
        throw error;
      }
      if (!result.rowCount) {
        try {
          await deleteImage(image.path);
        } catch {
          // Keep the response about the missing database product.
        }
        return response.status(404).json({ error: "Produkten hittades inte." });
      }

      const searchSync = await syncProduct(request.params.productId);
      const searchSyncResult = {
        searchIndexUpdated: searchSync.updated,
        searchIndexError: searchSync.error,
      };

      const oldImagePath = product.rows?.[0]?.image_storage_path;
      if (oldImagePath && oldImagePath !== image.path) {
        try {
          await deleteImage(oldImagePath);
        } catch {
          return response.status(201).json({ productId: request.params.productId, ...image, ...searchSyncResult, cleanupWarning: true });
        }
      }
      return response.status(201).json({ productId: request.params.productId, ...image, ...searchSyncResult });
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

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
