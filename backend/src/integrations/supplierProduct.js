export function mapSupplierProduct(row) {
  if (!row || typeof row !== "object") return invalid("Product data is missing.");
  if (typeof row.artNr !== "string" || !row.artNr.trim()) return invalid("Article number is missing.");
  if (typeof row.benamning !== "string" || !row.benamning.trim()) return invalid("Product name is missing.");
  if (typeof row.kategori !== "string" || !row.kategori.trim()) return invalid("Product category is missing.");
  if (row.valuta && row.valuta !== "SEK") return invalid("Price currency must be SEK.");

  const priceText = typeof row.pris === "string" ? row.pris.trim() : "";
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(priceText)) {
    return invalid("Price must be a non-negative number with at most two decimals.");
  }
  const price = Number(priceText.replace(",", "."));
  if (!Number.isFinite(price)) return invalid("Price must be a non-negative number with at most two decimals.");

  const stockText = typeof row.lagersaldo === "string" ? row.lagersaldo.trim() : "";
  if (stockText && !/^\d+$/.test(stockText)) {
    return invalid("Stock must be empty or a non-negative whole number.");
  }
  const stock = stockText ? Number(stockText) : 0;
  if (!Number.isSafeInteger(stock)) return invalid("Stock must be empty or a non-negative whole number.");

  return {
    product: {
      sku: row.artNr.trim(),
      name: row.benamning.trim(),
      categoryName: row.kategori.trim(),
      price,
      stock,
    },
    reason: null,
  };
}

function invalid(reason) {
  return { product: null, reason };
}
