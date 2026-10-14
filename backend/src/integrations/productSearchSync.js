import { deleteProductFromSearch, indexProducts } from "./algoliaAdapter.js";

export async function syncProductsToSearch(products, options = {}) {
  const save = options.indexProducts ?? indexProducts;
  const remove = options.deleteProduct ?? deleteProductFromSearch;
  try {
    const activeProducts = products.filter((product) => product.isActive);
    const inactiveProducts = products.filter((product) => !product.isActive);
    await save(activeProducts);
    for (const product of inactiveProducts) await remove(product.sku);
    for (const sku of options.removedSkus ?? []) await remove(sku);
    return { updated: true };
  } catch (error) {
    return {
      updated: false,
      error: error instanceof Error ? error.message : "Search index could not be updated.",
    };
  }
}
