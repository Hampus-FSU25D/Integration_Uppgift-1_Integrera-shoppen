import { pool } from "../db/pool.js";
import { fetchSupplierCatalog, SupplierApiError } from "./supplierAdapter.js";
import { parseSupplierCsv } from "./supplierCsv.js";
import { mapSupplierProduct } from "./supplierProduct.js";
import { parseSupplierXml } from "./supplierXml.js";

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

export async function saveSupplierProducts(rows, client) {
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
    return report;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
