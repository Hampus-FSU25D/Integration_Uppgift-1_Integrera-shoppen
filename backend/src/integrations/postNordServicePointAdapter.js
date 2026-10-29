const requestTimeoutMs = 8_000;
const servicePointsPath = "/rest/businesslocation/v5/servicepoints/nearest/byaddress";

export class PostNordApiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "PostNordApiError";
    this.status = options.status;
    this.providerMessage = options.providerMessage;
  }
}

export async function getNearbyServicePoints(postalCode, { env = process.env, fetchImpl = fetch } = {}) {
  const normalizedPostalCode = normalizeSwedishPostalCode(postalCode);
  if (!normalizedPostalCode) {
    throw new PostNordApiError("Ange ett giltigt svenskt postnummer med fem siffror.", { status: 400 });
  }

  const config = getConfig(env);
  const url = new URL(servicePointsPath, config.baseUrl);
  for (const [name, value] of Object.entries({
    apikey: config.apiKey,
    returnType: "json",
    countryCode: "SE",
    agreementCountry: "SE",
    postalCode: normalizedPostalCode,
    numberOfServicePoints: "10",
    context: "optionalservicepoint",
    responseFilter: "public",
    typeId: "24,25,54",
  })) {
    url.searchParams.set(name, value);
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "PostNord svarade inte i tid. Försök igen."
      : "Kunde inte nå PostNord. Försök igen senare.";
    throw new PostNordApiError(message, { cause: error, status: 502 });
  }

  if (!response.ok) {
    throw new PostNordApiError(`PostNord kunde inte hämta ombud (HTTP ${response.status}). Försök igen senare.`, {
      status: 502,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new PostNordApiError("PostNord returnerade ett ogiltigt svar.", { cause: error, status: 502 });
  }

  const points = payload?.servicePointInformationResponse?.servicePoints;
  if (!Array.isArray(points) || !points.every(isServicePoint)) {
    throw new PostNordApiError("PostNord returnerade ett ogiltigt svar.", { status: 502 });
  }

  return points.map(mapServicePoint);
}

export async function getDeliveryEstimate({ postalCode, deliveryType }, {
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const destinationPostalCode = normalizeSwedishPostalCode(postalCode);
  if (!destinationPostalCode) {
    throw new PostNordApiError("Ange ett giltigt svenskt postnummer för leveransen.", { status: 400 });
  }
  if (deliveryType !== "home" && deliveryType !== "service-point") {
    throw new PostNordApiError("Välj ett giltigt fraktsätt.", { status: 400 });
  }

  const config = getConfig(env);
  const customerKey = env.POSTNORD_CUSTOMER_KEY;
  const originPostalCode = normalizeSwedishPostalCode(env.POSTNORD_ORIGIN_POSTAL_CODE);
  const originCity = env.POSTNORD_ORIGIN_CITY?.trim();
  const originStreet = env.POSTNORD_ORIGIN_STREET?.trim();
  if (!customerKey || !originPostalCode || !originCity || !originStreet) {
    throw new PostNordApiError(
      "PostNord-leveransberäkning är inte konfigurerad. Ange kundnyckel och lageradress på backend.",
      { status: 503 },
    );
  }

  const url = new URL("/rest/shipment/v1/deliveryoptions/bywarehouse", config.baseUrl);
  url.searchParams.set("apikey", config.apiKey);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        warehouses: [{
          id: "shop",
          address: { street: originStreet, city: originCity, postCode: originPostalCode, countryCode: "SE" },
          orderHandling: { handOverTimer: now().toISOString().replace(/\.\d{3}Z$/, "Z") },
        }],
        customer: { customerKey },
        recipient: { address: { postCode: destinationPostalCode, countryCode: "SE" } },
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "PostNord svarade inte i tid. Försök igen."
      : "Kunde inte nå PostNord. Försök igen senare.";
    throw new PostNordApiError(message, { cause: error, status: 502 });
  }

  if (!response.ok) {
    const providerMessage = await readProviderErrorMessage(response, [
      config.apiKey,
      customerKey,
      originStreet,
      originPostalCode,
      destinationPostalCode,
    ]);
    throw new PostNordApiError(`PostNord kunde inte beräkna leveranstid (HTTP ${response.status}). Försök igen senare.`, {
      status: 502,
      providerMessage,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new PostNordApiError("PostNord returnerade ett ogiltigt leveranssvar.", { cause: error, status: 502 });
  }

  const warehouseOptions = payload?.warehouseToDeliveryOptions;
  if (!Array.isArray(warehouseOptions) ||
      !warehouseOptions.every((warehouse) => Array.isArray(warehouse?.deliveryOptions))) {
    throw new PostNordApiError("PostNord kunde inte lämna ett giltigt leveransalternativ för valt fraktsätt.", {
      status: 502,
    });
  }

  const options = warehouseOptions.flatMap((warehouse) => warehouse.deliveryOptions);
  const option = options?.find((candidate) => candidate?.type === deliveryType);
  const dayRange = option?.defaultOption?.deliveryTime?.dayRange;
  if (typeof dayRange?.days !== "string" ||
      !/^\d+(?:-\d+)?$/.test(dayRange.days) ||
      (dayRange.latest !== undefined && typeof dayRange.latest !== "string")) {
    throw new PostNordApiError("PostNord kunde inte lämna ett giltigt leveransalternativ för valt fraktsätt.", {
      status: 502,
    });
  }

  return {
    deliveryType,
    days: dayRange.days,
    ...(dayRange.latest ? { latest: dayRange.latest } : {}),
  };
}

function normalizeSwedishPostalCode(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{3} ?\d{2}$/.test(trimmed) ? trimmed.replace(" ", "") : null;
}

function getConfig(env) {
  const apiKey = env.POSTNORD_API_KEY;
  const baseUrl = env.POSTNORD_API_BASE_URL?.replace(/\/+$/, "");
  if (!apiKey || !baseUrl) {
    throw new PostNordApiError("PostNord är inte konfigurerat. Ange POSTNORD_API_KEY och POSTNORD_API_BASE_URL på backend.", {
      status: 503,
    });
  }

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.hostname !== "atapi2.postnord.com" || url.username || url.password) {
      throw new Error("Invalid sandbox URL");
    }
  } catch (error) {
    throw new PostNordApiError("PostNords sandbox-adress måste vara https://atapi2.postnord.com.", {
      cause: error,
      status: 503,
    });
  }

  return { apiKey, baseUrl };
}

async function readProviderErrorMessage(response, sensitiveValues) {
  try {
    const payload = await response.json();
    const message = [
      payload?.message,
      payload?.errorMessage,
      payload?.error_description,
      payload?.error?.message,
      ...(Array.isArray(payload?.errors) ? payload.errors.map((error) => error?.message) : []),
    ].find((value) => typeof value === "string" && value.trim());
    if (!message) return undefined;

    return sensitiveValues.reduce(
      (safeMessage, value) => value ? safeMessage.replaceAll(value, "[redacted]") : safeMessage,
      message.trim().slice(0, 300),
    );
  } catch {
    return undefined;
  }
}

function isServicePoint(point) {
  const address = point?.visitingAddress;
  return typeof point?.servicePointId === "string" && point.servicePointId.length > 0 &&
    typeof point.name === "string" && point.name.length > 0 &&
    address?.countryCode === "SE" && typeof address.streetName === "string" &&
    typeof address.postalCode === "string" && /^\d{3} ?\d{2}$/.test(address.postalCode) &&
    typeof address.city === "string" && address.city.length > 0 &&
    (address.streetNumber === undefined || typeof address.streetNumber === "string");
}

function mapServicePoint(point) {
  const address = point.visitingAddress;
  return {
    id: point.servicePointId,
    countryCode: address.countryCode,
    name: point.name,
    address: [address.streetName, address.streetNumber].filter(Boolean).join(" "),
    postalCode: address.postalCode,
    city: address.city,
  };
}
