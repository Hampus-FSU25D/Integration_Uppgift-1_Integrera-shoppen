const defaults = {
  servicePointPrice: 59,
  homePrice: 99,
  freeShippingThreshold: 500,
};

export function calculateShippingOptions(subtotalMinorUnits, env = process.env) {
  if (!Number.isSafeInteger(subtotalMinorUnits) || subtotalMinorUnits < 0) {
    throw new ShippingPricingError("Fraktpriser kunde inte beräknas.");
  }

  const servicePointPrice = configuredWholeSek(env.SHIPPING_SERVICE_POINT_PRICE_SEK, defaults.servicePointPrice);
  const homePrice = configuredWholeSek(env.SHIPPING_HOME_PRICE_SEK, defaults.homePrice);
  const freeShippingThreshold = configuredWholeSek(env.SHIPPING_FREE_THRESHOLD_SEK, defaults.freeShippingThreshold);
  const isFree = BigInt(subtotalMinorUnits) >= BigInt(freeShippingThreshold) * 100n;

  return [
    { method: "service-point", price: isFree ? 0 : servicePointPrice },
    { method: "home", price: isFree ? 0 : homePrice },
  ];
}

export function priceToMinorUnits(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function configuredWholeSek(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ShippingPricingError("Fraktpriser är inte konfigurerade korrekt. Ange hela SEK-belopp.");
  }
  return Number(value);
}

export class ShippingPricingError extends Error {}
