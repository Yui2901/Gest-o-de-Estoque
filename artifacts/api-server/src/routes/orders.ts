import { Router, type IRouter } from "express";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, orderItemsTable, ordersTable, productsTable, stockMovementsTable } from "@workspace/db";
import {
  CreateOrderBody,
  CreateOrderResponse,
  ListOrdersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type OrderStatus = "finalized";

function formatOrder(
  order: typeof ordersTable.$inferSelect,
  items: typeof orderItemsTable.$inferSelect[],
) {
  return {
    ...order,
    status: order.status as OrderStatus,
    items,
  };
}

router.get("/orders", async (_req, res): Promise<void> => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  if (orders.length === 0) {
    res.json(ListOrdersResponse.parse([]));
    return;
  }

  const items = await db
    .select()
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, orders.map((order) => order.id)));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item);
    itemsByOrder.set(item.orderId, current);
  }

  res.json(ListOrdersResponse.parse(
    orders.map((order) => formatOrder(order, itemsByOrder.get(order.id) ?? [])),
  ));
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid purchase order");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const productIds = parsed.data.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "Each product can appear only once in an order" });
    return;
  }

  try {
    const order = await db.transaction(async (tx) => {
      const products = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
      const productsById = new Map(products.map((product) => [product.id, product]));

      if (products.length !== productIds.length) {
        throw new Error("One or more selected products were not found");
      }

      const items = parsed.data.items.map((input) => {
        const product = productsById.get(input.productId);
        if (!product) throw new Error("One or more selected products were not found");
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: input.quantity,
          unitPrice: product.unitPrice,
          totalValue: product.unitPrice * input.quantity,
        };
      });
      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      const totalValue = items.reduce((sum, item) => sum + item.totalValue, 0);

      const [createdOrder] = await tx
        .insert(ordersTable)
        .values({ status: "finalized", totalItems, totalValue })
        .returning();

      const createdItems = await tx.insert(orderItemsTable).values(
        items.map((item) => ({ ...item, orderId: createdOrder.id })),
      ).returning();

      for (const item of items) {
        await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} + ${item.quantity}` })
          .where(eq(productsTable.id, item.productId));
        await tx.insert(stockMovementsTable).values({
          productId: item.productId,
          type: "in",
          quantity: item.quantity,
          note: `Pedido de compras #${createdOrder.id}`,
        });
      }

      return { order: createdOrder, items: createdItems };
    });

    res.status(201).json(CreateOrderResponse.parse(formatOrder(order.order, order.items)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finalize purchase order";
    req.log.error({ err: error }, "Failed to finalize purchase order");
    res.status(400).json({ error: message });
  }
});

export default router;