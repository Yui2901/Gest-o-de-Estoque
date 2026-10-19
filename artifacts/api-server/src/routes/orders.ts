import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  inventoryStocksTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  stockMovementsTable,
  storageLocationsTable,
  suppliersTable,
  warehousesTable,
} from "@workspace/db";
import { CreateOrderBody, CreateOrderResponse, ListOrdersResponse } from "@workspace/api-zod";
import { operationalUsers, requireRoles } from "../middlewares/auth";

const router: IRouter = Router();
const salesAndEntryUsers = operationalUsers;

type OrderType = "in" | "out";
type OrderStatus = "finalized";

function formatOrder(
  order: typeof ordersTable.$inferSelect & { supplierName: string | null; locationName: string | null },
  items: typeof orderItemsTable.$inferSelect[],
) {
  return {
    ...order,
    type: order.type as OrderType,
    status: order.status as OrderStatus,
    items,
  };
}

router.get("/orders", salesAndEntryUsers, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: ordersTable.id,
    type: ordersTable.type,
    status: ordersTable.status,
    customerName: ordersTable.customerName,
    customerPhone: ordersTable.customerPhone,
    customerId: ordersTable.customerId,
    supplierId: ordersTable.supplierId,
    supplierName: suppliersTable.name,
    locationId: ordersTable.locationId,
    locationName: storageLocationsTable.name,
    paymentMethod: ordersTable.paymentMethod,
    installments: ordersTable.installments,
    totalItems: ordersTable.totalItems,
    totalValue: ordersTable.totalValue,
    createdAt: ordersTable.createdAt,
  }).from(ordersTable)
    .leftJoin(suppliersTable, eq(ordersTable.supplierId, suppliersTable.id))
    .leftJoin(storageLocationsTable, eq(ordersTable.locationId, storageLocationsTable.id))
    .orderBy(desc(ordersTable.createdAt));
  if (!rows.length) {
    res.json(ListOrdersResponse.parse([]));
    return;
  }
  const items = await db.select().from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, rows.map((order) => order.id)));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item);
    itemsByOrder.set(item.orderId, current);
  }
  res.json(ListOrdersResponse.parse(rows.map((order) => ({
    ...formatOrder(order, itemsByOrder.get(order.id) ?? []),
  }))));
});

router.post("/orders", salesAndEntryUsers, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid stock order");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orderInput = parsed.data;
  const productIds = orderInput.items.map((item) => item.productId);
  const isManager = req.appUser?.role === "administrator" || req.appUser?.role === "manager";
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "Cada produto pode aparecer apenas uma vez por operação" });
    return;
  }
  if (orderInput.type === "out" && !orderInput.customerId
    && (!orderInput.customerName?.trim() || !orderInput.customerPhone?.trim())) {
    res.status(400).json({ error: "Informe um cliente cadastrado ou nome e telefone para a venda" });
    return;
  }
  if (orderInput.type === "in" && isManager && !orderInput.supplierId) {
    res.status(400).json({ error: "Selecione um fornecedor para registrar uma compra" });
    return;
  }
  if (!isManager && (orderInput.supplierId || orderInput.items.some((item) => item.unitPrice !== undefined))) {
    res.status(403).json({ error: "Somente gerente ou administrador pode registrar compras com fornecedor e custo" });
    return;
  }
  if (orderInput.type === "out" && orderInput.items.some((item) => item.unitPrice !== undefined)) {
    res.status(400).json({ error: "O valor dos itens de venda usa o preço cadastrado no produto" });
    return;
  }
  if (orderInput.type === "out" && orderInput.installments && orderInput.installments > 1
    && orderInput.paymentMethod !== "credit_card") {
    res.status(400).json({ error: "Parcelamento disponível apenas para cartão de crédito" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const locationRows = await tx.select({
        id: storageLocationsTable.id,
        name: storageLocationsTable.name,
      }).from(storageLocationsTable)
        .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
        .where(orderInput.locationId
          ? and(eq(storageLocationsTable.id, orderInput.locationId), eq(warehousesTable.active, true))
          : eq(warehousesTable.active, true))
        .orderBy(storageLocationsTable.id)
        .limit(1);
      const location = locationRows[0];
      if (!location) throw new Error("Selecione uma localização ativa para a operação");

      let customer = null;
      if (orderInput.customerId) {
        const [found] = await tx.select().from(customersTable)
          .where(eq(customersTable.id, orderInput.customerId)).limit(1);
        if (!found) throw new Error("Cliente não encontrado");
        customer = found;
      }
      let supplier = null;
      if (orderInput.supplierId) {
        const [found] = await tx.select().from(suppliersTable)
          .where(eq(suppliersTable.id, orderInput.supplierId)).limit(1);
        if (!found) throw new Error("Fornecedor não encontrado");
        supplier = found;
      }
      const products = await tx.select().from(productsTable)
        .where(inArray(productsTable.id, productIds)).for("update");
      const productsById = new Map(products.map((product) => [product.id, product]));
      if (products.length !== productIds.length) throw new Error("Um ou mais produtos não foram encontrados");

      const items = orderInput.items.map((input) => {
        const product = productsById.get(input.productId);
        if (!product) throw new Error("Produto não encontrado");
        const unitPrice = orderInput.type === "in"
          ? input.unitPrice ?? product.unitPrice
          : product.unitPrice;
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: input.quantity,
          unitPrice,
          totalValue: unitPrice * input.quantity,
        };
      });
      const [createdOrder] = await tx.insert(ordersTable).values({
        type: orderInput.type,
        status: "finalized",
        customerName: customer?.name ?? orderInput.customerName?.trim() ?? null,
        customerPhone: customer?.phone ?? orderInput.customerPhone?.trim() ?? null,
        customerId: customer?.id ?? null,
        supplierId: supplier?.id ?? null,
        locationId: location.id,
        paymentMethod: orderInput.type === "out" ? orderInput.paymentMethod ?? "pix" : null,
        installments: orderInput.type === "out" ? orderInput.installments ?? 1 : 1,
        totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
        totalValue: items.reduce((sum, item) => sum + item.totalValue, 0),
      }).returning();
      const createdItems = await tx.insert(orderItemsTable)
        .values(items.map((item) => ({ ...item, orderId: createdOrder.id })))
        .returning();

      for (const item of items) {
        const product = productsById.get(item.productId)!;
        const [balance] = await tx.select().from(inventoryStocksTable)
          .where(and(
            eq(inventoryStocksTable.productId, item.productId),
            eq(inventoryStocksTable.locationId, location.id),
          )).limit(1);
        const balanceQuantity = balance?.quantity ?? 0;
        const delta = orderInput.type === "in" ? item.quantity : -item.quantity;
        if (balanceQuantity + delta < 0 || product.stock + delta < 0) {
          throw new Error(`A saída de ${item.productName} é maior que o saldo disponível nesta localização`);
        }
        if (balance) {
          await tx.update(inventoryStocksTable)
            .set({ quantity: balanceQuantity + delta })
            .where(eq(inventoryStocksTable.id, balance.id));
        } else {
          await tx.insert(inventoryStocksTable).values({
            productId: item.productId,
            locationId: location.id,
            quantity: balanceQuantity + delta,
          });
        }
        await tx.update(productsTable)
          .set({ stock: sql`${productsTable.stock} + ${delta}` })
          .where(eq(productsTable.id, item.productId));
        await tx.insert(stockMovementsTable).values({
          productId: item.productId,
          locationId: location.id,
          orderId: createdOrder.id,
          type: orderInput.type,
          quantity: item.quantity,
          note: `${orderInput.type === "in" ? "Entrada" : "Venda"} pelo pedido #${createdOrder.id}`,
        });
      }
      return {
        order: {
          ...createdOrder,
          supplierName: supplier?.name ?? null,
          locationName: location.name,
        },
        items: createdItems,
      };
    });
    res.status(201).json(CreateOrderResponse.parse(formatOrder(result.order, result.items)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível concluir a operação";
    req.log.error({ err: error }, "Failed to finalize stock order");
    res.status(message.includes("não encontrado") ? 404 : 400).json({ error: message });
  }
});

export default router;