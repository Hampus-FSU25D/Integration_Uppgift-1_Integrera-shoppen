import { FormEvent, useState } from "react";
import { useCart } from "../../cart/CartContext";
import { Link } from "../../components/Link";
import { createCheckoutSession, createOrder, rememberOrderSummary } from "../../services/orderService";
import type { CreatedOrder } from "../../services/orderService";
import { formatPrice } from "../../utils/format";

export function CheckoutPage() {
  const { items, totalPrice } = useCart();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingCountry, setShippingCountry] = useState("Sverige");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<CreatedOrder | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (items.length === 0) {
      setMessage("Varukorgen är tom.");
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
                  onChange={(event) => setShippingPostalCode(event.target.value)}
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

          <p className="notice">Din order markeras som betald f&ouml;rst n&auml;r betalningen har bekr&auml;ftats.</p>

          <button type="submit" disabled={isSubmitting}>
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
            <span>{formatPrice(totalPrice)}</span>
          </div>
          <div className="summary-row">
            <span>Frakt</span>
            <strong>Gratis</strong>
          </div>
          <div className="summary-row total">
            <span>Totalt</span>
            <span>{formatPrice(totalPrice)}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
