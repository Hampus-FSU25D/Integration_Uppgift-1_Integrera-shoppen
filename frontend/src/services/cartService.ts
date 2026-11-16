import type { CartItem } from "../cart/CartContext";
import { apiRequest } from "../lib/api";

export async function getCartItems(_userId?: string, productIds: string[] = []): Promise<CartItem[]> {
  const query = new URLSearchParams();
  if (productIds.length > 0) query.set("productIds", productIds.join(","));
  return apiRequest<CartItem[]>(`/cart${query.size > 0 ? `?${query}` : ""}`);
}

export async function replaceCartItems(_userId: string | null, items: CartItem[]) {
  await apiRequest<void>("/cart", { method: "PUT", body: JSON.stringify({ items }) });
}
