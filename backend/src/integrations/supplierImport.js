import { pool } from "../db/pool.js";
import { fetchSupplierCatalog, SupplierApiError } from "./supplierAdapter.js";
import { parseSupplierCsv } from "./supplierCsv.js";
import { mapSupplierProduct } from "./supplierProduct.js";
import { parseSupplierXml } from "./supplierXml.js";
import { syncProductsToSearch } from "./productSearchSync.js";

const supplierBranch = "mat";

export async function importSupplierCatalog(format) {
  const content = await fetchSupplierCatalog(format, supplierBranch);
  let supplierProducts;
  let skippedRows = [];
  try {
    if (format === "csv") {
      const parsed = parseSupplierCsv(content);
      supplierProducts = parsed.rows;
      skippedRows = parsed.skipped.map((row) => ({
        product: null,
        raw: { artNr: row.articleNumber },
        reason: row.reason,
      }));
    } else {
      supplierProducts = parseSupplierXml(content);
    }
  } catch (error) {
    throw new SupplierApiError(`Supplier ${format.toUpperCase()} catalog could not be parsed: ${error.message}`);
  }

  const rows = [
    ...supplierProducts.map((raw) => ({ ...mapSupplierProduct(raw), raw })),
    ...skippedRows,
  ];
  const client = await pool.connect();
  try {
    return await saveSupplierProducts(rows, client);
  } finally {
    client.release();
  }
}

export async function saveSupplierProducts(rows, client, options = {}) {
  const report = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedProducts: [],
  };

  for (const row of rows) {
    if (!row.product) {
      report.skipped += 1;
      report.skippedProducts.push({
        articleNumber: row.raw?.artNr || null,
        reason: row.reason,
      });
    }
  }

  await client.query("begin");
  try {
    for (const { product } of rows) {
      if (!product) continue;

      const category = await client.query(
        `insert into categories (name, slug) values ($1, $2)
         on conflict (name) do update set name = excluded.name returning id`,
        [product.categoryName, slugify(product.categoryName)],
      );
      const result = await client.query(
        `insert into products (category_id, name, price, stock, sku)
         values ($1, $2, $3, $4, $5)
         on conflict (sku) do update set category_id = excluded.category_id, name = excluded.name,
         price = excluded.price, stock = excluded.stock, updated_at = now()
         returning (xmax = 0) as inserted`,
        [category.rows[0].id, product.name, product.price, product.stock, product.sku],
      );

      if (result.rows[0].inserted) report.created += 1;
      else report.updated += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  try {
    const result = await client.query(
      `select p.id,p.external_id,p.category_id,p.name,p.description,p.price,p.discount_percentage,p.rating,
       p.stock,p.brand,p.sku,p.image_url,p.is_active,c.name as category_name,c.slug as category_slug
       from products p left join categories c on c.id=p.category_id`,
    );
    const syncResult = await syncProductsToSearch(result.rows.map(mapProductRow), options);
    report.searchIndexUpdated = syncResult.updated;
    if (!syncResult.updated) report.searchIndexError = syncResult.error;
  } catch (error) {
    report.searchIndexUpdated = false;
    report.searchIndexError = error instanceof Error ? error.message : "Search index could not be updated.";
  }
  return report;
}

function mapProductRow(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    discountPercentage: Number(row.discount_percentage ?? 0),
    rating: row.rating === null ? null : Number(row.rating),
    stock: row.stock,
    brand: row.brand,
    sku: row.sku,
    imageUrl: row.image_url,
    isActive: row.is_active,
  };
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
