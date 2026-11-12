import express from "express";

export function createOrderHistoryRouter({ database }) {
  const router = express.Router();

  router.get("/mine", async (request, response, next) => {
    if (!request.session?.userId) return response.status(401).json({ error: "Login required." });

    try {
      const result = await database.query(
        `select o.id, o.total_price, o.status, o.created_at,
         coalesce(json_agg(json_build_object(
           'productName', oi.product_name,
           'quantity', oi.quantity,
           'priceAtPurchase', oi.price_at_purchase
         ) order by oi.created_at) filter (where oi.id is not null), '[]') as items
         from orders o
         left join order_items oi on oi.order_id = o.id
         where o.user_id = $1
         group by o.id
         order by o.created_at desc`,
        [request.session.userId],
      );

      return response.json(result.rows.map((order) => ({
        id: order.id,
        totalPrice: Number(order.total_price),
        status: order.status,
        createdAt: new Date(order.created_at).toISOString(),
        items: order.items,
      })));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
