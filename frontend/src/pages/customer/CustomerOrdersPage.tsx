import { useEffect, useState } from "react";
import { Link } from "../../components/Link";
import { getMyOrders, getOrderStatusLabel, type CustomerOrder } from "../../services/orderService";
import { formatPrice } from "../../utils/format";

type LoadState = "loading" | "ready" | "error" | "signed-out";

export function CustomerOrdersPage() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;

    void getMyOrders().then((result) => {
      if (!active) return;
      setOrders(result);
      setLoadState("ready");
    }).catch((error: Error) => {
      if (!active) return;
      setLoadState(error.message === "Login required." ? "signed-out" : "error");
    });

    return () => {
      active = false;
    };
  }, []);

  if (loadState === "loading") {
    return <section className="placeholder"><h1>Mina sidor</h1><p>Hämtar dina ordrar.</p></section>;
  }

  if (loadState === "signed-out") {
    return (
      <section className="placeholder auth-panel">
        <h1>Mina sidor</h1>
        <p>Logga in för att se dina ordrar.</p>
        <Link href="/login?next=%2Faccount%2Forders" className="primary-action">Logga in</Link>
      </section>
    );
  }

  if (loadState === "error") {
    return <section className="placeholder"><h1>Mina sidor</h1><p>Dina ordrar kunde inte hämtas just nu. Försök igen senare.</p></section>;
  }

  return (
    <section className="customer-orders-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Kundkonto</span>
          <h1>Mina sidor</h1>
          <p>Här ser du ordrar som du har lagt när du varit inloggad.</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="placeholder"><p>Du har inga ordrar ännu.</p><Link href="/" className="primary-action">Se produkter</Link></div>
      ) : (
        <div className="customer-order-list">
          {orders.map((order) => (
            <article className="customer-order-card" key={order.id}>
              <div className="customer-order-heading">
                <div>
                  <strong>Order #{order.id.slice(0, 8)}</strong>
                  <time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time>
                </div>
                <span className="badge">{getOrderStatusLabel(order.status)}</span>
              </div>
              <ul>
                {order.items.map((item, index) => (
                  <li key={`${item.productName}-${index}`}>
                    <span>{item.productName} × {item.quantity}</span>
                    <span>{formatPrice(item.priceAtPurchase * item.quantity)}</span>
                  </li>
                ))}
              </ul>
              <p className="customer-order-total"><span>Totalt</span><strong>{formatPrice(order.totalPrice)}</strong></p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(value));
}
