import { apiRequest } from "../lib/api";

export type ShippingMethod = "service-point" | "home";

export type ServicePoint = {
  id: string;
  countryCode: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
};

export type DeliveryEstimate = {
  deliveryType: ShippingMethod;
  days: string;
  latest?: string;
};

export type ShippingQuote = {
  subtotalPrice: number;
  options: Array<{
    method: ShippingMethod;
    price: number;
    totalPrice: number;
  }>;
};

export function getShippingQuote(items: Array<{ productId: string; quantity: number }>) {
  return apiRequest<ShippingQuote>("/shipping/quote", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function getServicePoints(postalCode: string) {
  const query = new URLSearchParams({ postalCode });
  return apiRequest<ServicePoint[]>(`/shipping/service-points?${query}`);
}

export function getDeliveryEstimate(postalCode: string, deliveryType: ShippingMethod) {
  const query = new URLSearchParams({ postalCode, deliveryType });
  return apiRequest<DeliveryEstimate>(`/shipping/delivery-estimate?${query}`);
}
