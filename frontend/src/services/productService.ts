import { apiRequest } from "../lib/api";

export type Category = {
  id: string;
  name: string;
  slug: string;
};

export type Product = {
  id: string;
  externalId: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  name: string;
  description: string | null;
  price: number;
  discountPercentage: number;
  rating: number | null;
  stock: number;
  brand: string | null;
  sku: string;
  imageUrl: string | null;
  isActive: boolean;
};

export type ProductFormInput = {
  categoryId: string | null;
  name: string;
  description: string;
  price: number;
  discountPercentage: number;
  stock: number;
  brand: string;
  sku: string;
  imageUrl: string;
  isActive: boolean;
};

export type SupplierImportFormat = "csv" | "xml";

export type SupplierImportReport = {
  created: number;
  updated: number;
  skipped: number;
  skippedProducts: Array<{ articleNumber: string | null; reason: string }>;
  searchIndexUpdated: boolean;
  searchIndexError?: string;
};

export type ProductSearchResult = {
  hits: Product[];
  totalHits: number;
  totalPages: number;
  page: number;
};

export type ProductSort = "relevance" | "price_asc" | "price_desc";

export type AdminProductSaveResult = Product & {
  searchIndexUpdated: boolean;
  searchIndexError?: string;
};

export type ProductImageUploadResult = {
  productId: string;
  path: string;
  publicUrl: string;
  searchIndexUpdated: boolean;
  searchIndexError?: string;
  cleanupWarning?: boolean;
};

export function getCategories() {
  return apiRequest<Category[]>("/categories");
}

export function getActiveProducts() {
  return apiRequest<Product[]>("/products");
}

export function searchActiveProducts(
  query: string,
  page: number,
  pageSize = 12,
  categorySlug?: string,
  sort: ProductSort = "relevance",
) {
  const params = new URLSearchParams({ query, page: String(page), pageSize: String(pageSize) });
  if (categorySlug) params.set("category", categorySlug);
  if (sort !== "relevance") params.set("sort", sort);
  return apiRequest<ProductSearchResult>(`/search?${params}`);
}

export function getAdminProducts() {
  return apiRequest<Product[]>("/admin/products");
}

export function importSupplierCatalog(format: SupplierImportFormat) {
  return apiRequest<SupplierImportReport>(`/admin/products/import/${format}`, { method: "POST" });
}

export function getActiveProductById(id: string) {
  return apiRequest<Product>(`/products/${encodeURIComponent(id)}`).catch((error: Error) => {
    if (error.message === "Product not found.") return null;
    throw error;
  });
}

export function getAdminProductById(id: string) {
  return apiRequest<Product>(`/admin/products/${encodeURIComponent(id)}`).catch((error: Error) => {
    if (error.message === "Product not found.") return null;
    throw error;
  });
}

export function createAdminProduct(input: ProductFormInput) {
  return apiRequest<AdminProductSaveResult>("/admin/products", { method: "POST", body: JSON.stringify(input) });
}

export function updateAdminProduct(id: string, input: ProductFormInput) {
  return apiRequest<AdminProductSaveResult>(`/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function uploadAdminProductImage(id: string, file: File) {
  const form = new FormData();
  form.append("image", file);
  return apiRequest<ProductImageUploadResult>(`/admin/products/${encodeURIComponent(id)}/image`, {
    method: "POST",
    body: form,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
}

export function deleteAdminProduct(id: string) {
  return apiRequest<{ deleted: boolean; searchIndexUpdated: boolean; searchIndexError?: string }>(
    `/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" },
  );
}
