import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  orderItemsTable,
  ordersTable,
} from "@workspace/db";
import {
  CreateCustomerBody,
  CreateCustomerResponse,
  DeleteCustomerParams,
  GetCustomerParams,
  GetCustomerPurchaseHistoryParams,
  GetCustomerPurchaseHistoryResponse,
  GetCustomerResponse,
  ListCustomersResponse,
  UpdateCustomerBody,
  UpdateCustomerParams,
  UpdateCustomerResponse,
} from "@workspace/api-zod";
import { managersAndAdministrators, operationalUsers } from "../middlewares/auth";

const router: IRouter = Router();

function normalizedDocument(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.length !== 11 && digits.length !== 14) {
    throw new Error("CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos");
  }
  return digits;
}

async function customerTotals(customerId?: number) {
  return db.select({
    id: customersTable.id,
    name: customersTable.name,
    document: customersTable.document,
    phone: customersTable.phone,
    email: customersTable.email,
    address: customersTable.address,
    createdAt: customersTable.createdAt,
    purchaseCount: sql<number>`count(${ordersTable.id})::int`,
    totalSpent: sql<number>`coalesce(sum(${ordersTable.totalValue}), 0)::float8`,
  }).from(customersTable)
    .leftJoin(ordersTable, and(eq(ordersTable.customerId, customersTable.id), eq(ordersTable.type, "out")))
    .where(customerId ? eq(customersTable.id, customerId) : undefined)
    .groupBy(customersTable.id)
    .orderBy(desc(customersTable.createdAt));
}

router.get("/customers", operationalUsers, async (_req, res): Promise<void> => {
  const customers = await customerTotals();
  res.json(ListCustomersResponse.parse(customers));
});

router.post("/customers", operationalUsers, async (req, res): Promise<void> => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let document: string | null;
  try {
    document = normalizedDocument(parsed.data.document);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const [customer] = await db.insert(customersTable).values({
    name: parsed.data.name.trim(),
    phone: parsed.data.phone.trim(),
    document,
    email: parsed.data.email?.trim().toLowerCase() || null,
    address: parsed.data.address?.trim() || null,
  }).returning();
  res.status(201).json(CreateCustomerResponse.parse({ ...customer, purchaseCount: 0, totalSpent: 0 }));
});

router.get("/customers/:id", operationalUsers, async (req, res): Promise<void> => {
  const params = GetCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await customerTotals(params.data.id);
  if (!customer) {
    res.status(404).json({ error: "Cliente não encontrado" });
    return;
  }
  res.json(GetCustomerResponse.parse(customer));
});

router.patch("/customers/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = UpdateCustomerParams.safeParse(req.params);
  const parsed = UpdateCustomerBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Dados inválidos para atualizar o cliente" });
    return;
  }
  let document: string | null | undefined;
  try {
    document = parsed.data.document === undefined ? undefined : normalizedDocument(parsed.data.document);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const [updated] = await db.update(customersTable).set({
    ...parsed.data,
    ...(document !== undefined ? { document } : {}),
    ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.phone ? { phone: parsed.data.phone.trim() } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email?.trim().toLowerCase() || null } : {}),
    ...(parsed.data.address !== undefined ? { address: parsed.data.address?.trim() || null } : {}),
  }).where(eq(customersTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Cliente não encontrado" });
    return;
  }
  const [customer] = await customerTotals(updated.id);
  res.json(UpdateCustomerResponse.parse(customer));
});

router.delete("/customers/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = DeleteCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(customersTable)
    .where(eq(customersTable.id, params.data.id))
    .returning({ id: customersTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Cliente não encontrado" });
    return;
  }
  res.sendStatus(204);
});

router.get("/customers/:id/purchase-history", operationalUsers, async (req, res): Promise<void> => {
  const params = GetCustomerPurchaseHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const orders = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.customerId, params.data.id), eq(ordersTable.type, "out")))
    .orderBy(desc(ordersTable.createdAt));
  if (!orders.length) {
    const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
      .where(eq(customersTable.id, params.data.id)).limit(1);
    if (!customer) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }
    res.json([]);
    return;
  }
  const items = await db.select().from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, orders.map((order) => order.id)));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const result = orders.map((order) => ({
    ...order,
    type: order.type as "in" | "out",
    status: order.status as "finalized",
    items: itemsByOrder.get(order.id) ?? [],
    supplierName: null,
    locationName: null,
  }));
  res.json(GetCustomerPurchaseHistoryResponse.parse(result));
});

export default router;
