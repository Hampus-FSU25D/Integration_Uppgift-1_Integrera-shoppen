import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "../../cart/CartContext";
import { Link } from "../../components/Link";
import { createCheckoutSession, createOrder, rememberOrderSummary } from "../../services/orderService";
import type { CreatedOrder } from "../../services/orderService";
import { getDeliveryEstimate, getServicePoints, getShippingQuote } from "../../services/shippingService";
import type { DeliveryEstimate, ServicePoint, ShippingMethod, ShippingQuote } from "../../services/shippingService";
import { formatPrice } from "../../utils/format";

export function CheckoutPage() {
  const { items } = useCart();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingCountry, setShippingCountry] = useState("Sverige");
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("service-point");
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [selectedServicePoint, setSelectedServicePoint] = useState<ServicePoint | null>(null);
  const [deliveryEstimate, setDeliveryEstimate] = useState<DeliveryEstimate | null>(null);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [servicePointError, setServicePointError] = useState("");
  const [estimateError, setEstimateError] = useState("");
  const [isLoadingQuote, setIsLoadingQuote] = useState(true);
  const [isLoadingServicePoints, setIsLoadingServicePoints] = useState(false);
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<CreatedOrder | null>(null);
  const servicePointRequestId = useRef(0);
  const estimateRequestId = useRef(0);
  const quoteItems = useMemo(
    () => items.map(({ productId, quantity }) => ({ productId, quantity })),
    [items],
  );
  const selectedShippingOption = shippingQuote?.options.find((option) => option.method === shippingMethod);

  useEffect(() => {
    let active = true;
    setIsLoadingQuote(true);
    setQuoteError("");

    getShippingQuote(quoteItems)
      .then((quote) => {
        if (active) setShippingQuote(quote);
      })
      .catch((error: Error) => {
        if (active) {
          setShippingQuote(null);
          setQuoteError(error.message || "Fraktpriset kunde inte hämtas.");
        }
      })
      .finally(() => {
        if (active) setIsLoadingQuote(false);
      });

    return () => {
      active = false;
    };
  }, [quoteItems]);

  function handlePostalCodeChange(value: string) {
    servicePointRequestId.current += 1;
    estimateRequestId.current += 1;
    setIsLoadingServicePoints(false);
    setIsLoadingEstimate(false);
    setShippingPostalCode(value);
    setServicePoints([]);
    setSelectedServicePoint(null);
    setServicePointError("");
    setDeliveryEstimate(null);
    setEstimateError("");
  }

  async function handleFindServicePoints() {
    const requestId = ++servicePointRequestId.current;
    setIsLoadingServicePoints(true);
    setServicePointError("");
    setServicePoints([]);
    setSelectedServicePoint(null);

    try {
      const points = await getServicePoints(shippingPostalCode);
      if (requestId !== servicePointRequestId.current) return;
      setServicePoints(points);
      if (points.length === 0) setServicePointError("Inga ombud hittades för postnumret.");
    } catch (error) {
      if (requestId === servicePointRequestId.current) {
        setServicePointError(error instanceof Error ? error.message : "Ombuden kunde inte hämtas.");
      }
    } finally {
      if (requestId === servicePointRequestId.current) setIsLoadingServicePoints(false);
    }
  }

  async function handleGetDeliveryEstimate() {
    const requestId = ++estimateRequestId.current;
    setIsLoadingEstimate(true);
    setEstimateError("");
    setDeliveryEstimate(null);

    try {
      const estimate = await getDeliveryEstimate(
        shippingPostalCode,
        shippingMethod === "home" ? "home" : "service-point",
      );
      if (requestId === estimateRequestId.current) setDeliveryEstimate(estimate);
    } catch (error) {
      if (requestId === estimateRequestId.current) {
        setEstimateError(error instanceof Error ? error.message : "Leveranstiden kunde inte hämtas.");
      }
    } finally {
      if (requestId === estimateRequestId.current) setIsLoadingEstimate(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (items.length === 0) {
      setMessage("Varukorgen är tom.");
      return;
    }
    if (!selectedShippingOption) {
      setMessage(quoteError || "Fraktpriset är inte tillgängligt. Försök hämta priset igen.");
      return;
    }
    if (shippingMethod === "service-point" && !selectedServicePoint) {
      setMessage("Hämta och välj ett ombud innan du fortsätter.");
      return;
    }

    setIsSubmitting(true);

    try {
      let order = pendingOrder;
      if (!order) {
        try {
          order = await createOrder({
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            shippingPostalCode,
            shippingCity,
            shippingCountry,
            items,
          });
        } catch {
          setMessage("Ordern kunde inte skapas. Kontrollera uppgifterna, lagersaldot och anslutningen och f\u00f6rs\u00f6k igen.");
          return;
        }

        setPendingOrder(order);
        rememberOrderSummary(order);
      }

      try {
        const session = await createCheckoutSession(order);
        window.location.assign(session.url);
      } catch {
        setMessage("Ordern \u00e4r sparad, men betalningen kunde inte startas. F\u00f6rs\u00f6k igen.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="placeholder">
        <h1>Kassa</h1>
        <p>Varukorgen är tom.</p>
        <p>
          <Link href="/">Till produkterna</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="checkout-page">
      <div className="page-heading">
        <div>
          <h1>Kassa</h1>
          <p>Betalningen sker via Stripe i testl&auml;ge. Inga riktiga betalningar genomf&ouml;rs.</p>
        </div>
        <Link href="/cart">Tillbaka till varukorgen</Link>
      </div>

      <div className="checkout-layout">
        <form className="form-block checkout-form checkout-panel" onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting || pendingOrder !== null}>
            <legend>Kundinformation</legend>
            <div className="form-row">
              <label>
                Namn
                <input
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  required
                  autoComplete="name"
                />
              </label>

              <label>
                Telefon
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  required
                  autoComplete="tel"
                />
              </label>
            </div>

            <label>
              E-postadress
              <input
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>
          </fieldset>

          <fieldset disabled={isSubmitting || pendingOrder !== null}>
            <legend>Leveransadress</legend>
            <label>
              Adress
              <input
                type="text"
                value={shippingAddress}
                onChange={(event) => setShippingAddress(event.target.value)}
                required
                autoComplete="street-address"
              />
            </label>

            <div className="form-row">
              <label>
                Postnummer
                <input
                  type="text"
                  value={shippingPostalCode}
                  onChange={(event) => handlePostalCodeChange(event.target.value)}
                  required
                  autoComplete="postal-code"
                />
              </label>

              <label>
                Ort
                <input
                  type="text"
                  value={shippingCity}
                  onChange={(event) => setShippingCity(event.target.value)}
                  required
                  autoComplete="address-level2"
                />
              </label>

              <label>
                Land
                <input
                  type="text"
                  value={shippingCountry}
                  onChange={(event) => setShippingCountry(event.target.value)}
                  required
                  autoComplete="country-name"
                />
              </label>
            </div>
          </fieldset>

          <fieldset disabled={isSubmitting || pendingOrder !== null} className="shipping-options">
            <legend>Fraktsätt</legend>
            <div className="shipping-choice-list">
              <label className="shipping-choice">
                <input
                  type="radio"
                  name="shippingMethod"
                  value="service-point"
                  checked={shippingMethod === "service-point"}
                  onChange={() => {
                    estimateRequestId.current += 1;
                    setIsLoadingEstimate(false);
                    setShippingMethod("service-point");
                    setDeliveryEstimate(null);
                    setEstimateError("");
                  }}
                />
                <span>
                  <strong>Hämta hos ombud</strong>
                  <span>{isLoadingQuote ? "Hämtar fraktpris…" : shippingQuote && formatPrice(shippingQuote.options.find((option) => option.method === "service-point")?.price ?? 0)}</span>
                </span>
              </label>
              <label className="shipping-choice">
                <input
                  type="radio"
                  name="shippingMethod"
                  value="home"
                  checked={shippingMethod === "home"}
                  onChange={() => {
                    estimateRequestId.current += 1;
                    setIsLoadingEstimate(false);
                    setShippingMethod("home");
                    setDeliveryEstimate(null);
                    setEstimateError("");
                  }}
                />
                <span>
                  <strong>Hemleverans</strong>
                  <span>{isLoadingQuote ? "Hämtar fraktpris…" : shippingQuote && formatPrice(shippingQuote.options.find((option) => option.method === "home")?.price ?? 0)}</span>
                </span>
              </label>
            </div>

            {shippingMethod === "service-point" && (
              <div className="service-point-search">
                <button type="button" onClick={handleFindServicePoints} disabled={isLoadingServicePoints || shippingPostalCode.trim().length < 5}>
                  {isLoadingServicePoints ? "Hämtar ombud…" : "Hämta ombud"}
                </button>
                {servicePointError && <p className="form-message" role="alert">{servicePointError}</p>}
                {servicePoints.length > 0 && (
                  <div className="service-point-list" role="radiogroup" aria-label="Välj ombud">
                    {servicePoints.map((point) => (
                      <label className="service-point-option" key={`${point.countryCode}-${point.id}`}>
                        <input
                          type="radio"
                          name="servicePoint"
                          checked={selectedServicePoint?.id === point.id && selectedServicePoint.countryCode === point.countryCode}
                          onChange={() => setSelectedServicePoint(point)}
                        />
                        <span>
                          <strong>{point.name}</strong>
                          <span>{point.address}, {point.postalCode} {point.city}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="delivery-estimate">
              <button type="button" className="secondary-button" onClick={handleGetDeliveryEstimate} disabled={isLoadingEstimate || shippingPostalCode.trim().length < 5}>
                {isLoadingEstimate ? "Hämtar leveranstid…" : "Beräkna leveranstid"}
              </button>
              {deliveryEstimate && (
                <p role="status">
                  Beräknad leverans: {deliveryEstimate.days} {deliveryEstimate.days === "1" ? "dag" : "dagar"}
                  {deliveryEstimate.latest ? `, senast ${deliveryEstimate.latest}` : ""}.
                </p>
              )}
              {estimateError && <p className="form-message" role="alert">{estimateError}</p>}
            </div>
          </fieldset>

          <p className="notice">Din order markeras som betald f&ouml;rst n&auml;r betalningen har bekr&auml;ftats.</p>

          <button type="submit" disabled={isSubmitting || isLoadingQuote || !selectedShippingOption}>
            {isSubmitting ? "\u00d6ppnar betalningen..." : pendingOrder ? "F\u00f6rs\u00f6k igen" : "G\u00e5 till betalning"}
          </button>

          {message && <p className="form-message" role="alert">{message}</p>}
        </form>

        <aside className="order-summary">
          <h2>Din beställning</h2>
          <ul className="summary-list">
            {items.map((item) => (
              <li className="summary-item" key={item.productId}>
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span />}
                <span>
                  <strong>{item.name}</strong>
                  <span>Antal: {item.quantity}</span>
                </span>
                <strong>{formatPrice(item.price * item.quantity)}</strong>
              </li>
            ))}
          </ul>
          <div className="summary-row">
            <span>Delsumma</span>
            <span>{shippingQuote ? formatPrice(shippingQuote.subtotalPrice) : "—"}</span>
          </div>
          <div className="summary-row">
            <span>Frakt ({shippingMethod === "home" ? "hemleverans" : "ombud"})</span>
            <span>{selectedShippingOption ? formatPrice(selectedShippingOption.price) : "—"}</span>
          </div>
          <div className="summary-row total">
            <span>Totalt</span>
            <span>{selectedShippingOption ? formatPrice(selectedShippingOption.totalPrice) : "—"}</span>
          </div>
          {quoteError && <p className="form-message" role="alert">{quoteError}</p>}
        </aside>
      </div>
    </section>
  );
}
