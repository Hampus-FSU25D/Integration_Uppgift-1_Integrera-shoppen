import { useEffect, useRef, useState } from "react";
import { useCart } from "../../cart/CartContext";
import { Link } from "../../components/Link";
import type { PageProps } from "../../routes/routes";
import { getOrderSummary, getRememberedOrderSummary, type CreatedOrder } from "../../services/orderService";
import { formatPrice } from "../../utils/format";

type LoadState = "loading" | "ready" | "error" | "not-found";

export function OrderConfirmationPage({ path }: PageProps) {
  const orderId = path.split("/").at(-1) ?? "";
  const { clearCart, isReady: isCartReady } = useCart();
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const clearedCartForOrder = useRef<string | null>(null);

  useEffect(() => {
    if (order?.status !== "confirmed" || !isCartReady || clearedCartForOrder.current === orderId) return;
    clearedCartForOrder.current = orderId;
    clearCart();
  }, [clearCart, isCartReady, order?.status, orderId]);

  useEffect(() => {
    let active = true;
    let pollTimer: number | undefined;

    async function loadOrder(attempt = 0) {
      try {
        const orderSummary = await getOrderSummary(orderId);

        if (!active) {
          return;
        }

        if (!orderSummary) {
          const rememberedOrderSummary = getRememberedOrderSummary(orderId);

          if (!rememberedOrderSummary) {
            setLoadState("not-found");
            return;
          }

          setOrder(rememberedOrderSummary);
          setLoadState("ready");
          return;
        }

        setOrder(orderSummary);
        setLoadState("ready");
        if (orderSummary.status === "pending" && attempt < 10) {
          pollTimer = window.setTimeout(() => void loadOrder(attempt + 1), 1500);
        }
      } catch {
        if (active) {
          const rememberedOrderSummary = getRememberedOrderSummary(orderId);

          if (rememberedOrderSummary) {
            setOrder(rememberedOrderSummary);
            setLoadState("ready");
            return;
          }

          setLoadState("error");
        }
      }
    }

    void loadOrder();

    return () => {
      active = false;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [orderId]);

  if (loadState === "loading") {
    return (
      <section className="placeholder auth-panel">
        <h1>Orderbekraftelse</h1>
        <p>Laddar order.</p>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="placeholder auth-panel">
        <h1>Orderbekraftelse</h1>
        <p>Ordern skapades, men bekräftelsen kunde inte hämtas.</p>
        <p>Ordernummer: {orderId}</p>
        <p>
          <Link href="/">Till produkterna</Link>
        </p>
      </section>
    );
  }

  if (loadState === "not-found" || !order) {
    return (
      <section className="placeholder auth-panel">
        <h1>Ordern hittades inte</h1>
        <p>
          <Link href="/">Till produkterna</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="placeholder auth-panel">
      <span className="badge">{order.status === "confirmed" ? "Betald" : order.status === "cancelled" ? "Avbruten" : "Order mottagen"}</span>
      <h1>Tack för din beställning!</h1>
      <p>{order.status === "confirmed" ? "Betalningen är bekräftad och lagersaldot är uppdaterat." : order.status === "cancelled" ? "Betalningen slutfördes inte och ordern avbröts." : "Vi har tagit emot din order. Betalningen inväntar bekräftelse."}</p>
      <dl className="product-facts">
        <div>
          <dt>Ordernummer</dt>
          <dd>#{order.id.slice(0, 8)}</dd>
        </div>
        <div>
          <dt>Order-ID</dt>
          <dd><code>{order.id}</code></dd>
        </div>
        <div>
          <dt>Totalbelopp</dt>
          <dd>{formatPrice(order.totalPrice)}</dd>
        </div>
      </dl>
      <Link href="/" className="primary-action">
        Tillbaka till produkter
      </Link>
    </section>
  );
}
