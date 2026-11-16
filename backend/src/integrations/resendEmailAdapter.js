const resendUrl = "https://api.resend.com/emails";
const requestTimeoutMs = 8_000;

export async function sendOrderConfirmation(order, items, {
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (!isValidOrder(order) || !Array.isArray(items) || items.length === 0 || !items.every(isValidItem)) {
    throw new ResendEmailError("Order confirmation data is invalid.");
  }

  if (typeof env.RESEND_API_KEY !== "string" || !env.RESEND_API_KEY.startsWith("re_") ||
      typeof env.EMAIL_FROM !== "string" || !env.EMAIL_FROM.trim()) {
    throw new ResendEmailError("Resend email credentials are not configured.");
  }

  const orderNumber = `#${order.id.slice(0, 8)}`;
  const rows = items.map((item) => ({
    name: escapeHtml(item.product_name),
    quantity: item.quantity,
    price: formatPrice(item.price_at_purchase),
  }));
  const safeName = escapeHtml(order.customer_name);
  const html = [
    `<p>Hej ${safeName},</p>`,
    `<p>Tack för din beställning ${escapeHtml(orderNumber)}.</p>`,
    "<ul>",
    ...rows.map((item) => `<li>${item.name} – ${item.quantity} st × ${item.price} SEK</li>`),
    "</ul>",
    `<p>Totalsumma: ${formatPrice(order.total_price)} SEK</p>`,
  ].join("");
  const text = [
    `Hej ${order.customer_name},`,
    `Tack för din beställning ${orderNumber}.`,
    ...items.map((item) => `${item.product_name} × ${item.quantity} – ${formatPrice(item.price_at_purchase)} SEK/st`),
    `Totalsumma: ${formatPrice(order.total_price)} SEK`,
  ].join("\n");

  let response;
  try {
    response = await fetchImpl(resendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `order-confirmation/${order.id}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [order.customer_email],
        subject: `Orderbekräftelse ${orderNumber}`,
        html,
        text,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new ResendEmailError("Resend email request failed.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ResendEmailError("Resend returned an invalid response.");
  }
  if (!response.ok || !result || typeof result.id !== "string" || !result.id.trim() || result.id.length > 200) {
    throw new ResendEmailError("Resend returned an invalid response.");
  }

  return { id: result.id };
}

function isValidOrder(order) {
  return order && isUuid(order.id) && typeof order.customer_name === "string" &&
    order.customer_name.trim().length > 0 && order.customer_name.length <= 300 &&
    typeof order.customer_email === "string" && order.customer_email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email) && isPrice(order.total_price);
}

function isValidItem(item) {
  return item && typeof item.product_name === "string" && item.product_name.trim().length > 0 &&
    item.product_name.length <= 300 && Number.isInteger(item.quantity) && item.quantity > 0 &&
    item.quantity <= 99 && isPrice(item.price_at_purchase);
}

function isPrice(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  return typeof text === "string" && /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text);
}

function formatPrice(value) {
  const text = String(value);
  const [whole, fraction = ""] = text.split(".");
  return `${whole},${fraction.padEnd(2, "0")}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class ResendEmailError extends Error {}
