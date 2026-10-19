import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import {
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
import {
  GetMovementReportQueryParams,
  GetMovementReportResponse,
  GetPurchaseReportQueryParams,
  GetPurchaseReportResponse,
  GetSalesReportQueryParams,
  GetSalesReportResponse,
  GetStockReportQueryParams,
  GetStockReportResponse,
} from "@workspace/api-zod";
import { requireRoles } from "../middlewares/auth";

const router: IRouter = Router();
const reportReaders = requireRoles("administrator", "manager");
const stockReportReaders = requireRoles("administrator", "manager", "consultation");

function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dateFilters(from?: Date, to?: Date) {
  if (from && to && utcDay(from) > utcDay(to)) {
    throw new Error("A data inicial deve ser anterior à data final");
  }
  const filters = [];
  if (from) filters.push(gte(ordersTable.createdAt, utcDay(from)));
  if (to) {
    const end = utcDay(to);
    end.setUTCDate(end.getUTCDate() + 1);
    filters.push(lt(ordersTable.createdAt, end));
  }
  return filters;
}

function movementDateFilters(from?: Date, to?: Date) {
  if (from && to && utcDay(from) > utcDay(to)) {
    throw new Error("A data inicial deve ser anterior à data final");
  }
  const filters = [];
  if (from) filters.push(gte(stockMovementsTable.createdAt, utcDay(from)));
  if (to) {
    const end = utcDay(to);
    end.setUTCDate(end.getUTCDate() + 1);
    filters.push(lt(stockMovementsTable.createdAt, end));
  }
  return filters;
}

router.get("/reports/stock", stockReportReaders, async (req, res): Promise<void> => {
  const parsed = GetStockReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db.select({
    productId: productsTable.id,
    sku: productsTable.sku,
    productName: productsTable.name,
    category: productsTable.category,
    warehouseId: warehousesTable.id,
    warehouseName: warehousesTable.name,
    locationId: storageLocationsTable.id,
    locationName: storageLocationsTable.name,
    quantity: inventoryStocksTable.quantity,
    minStock: productsTable.minStock,
    maxStock: productsTable.maxStock,
    unitPrice: productsTable.unitPrice,
  }).from(inventoryStocksTable)
    .innerJoin(productsTable, eq(inventoryStocksTable.productId, productsTable.id))
    .innerJoin(storageLocationsTable, eq(inventoryStocksTable.locationId, storageLocationsTable.id))
    .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
    .where(parsed.data.warehouseId
      ? eq(warehousesTable.id, parsed.data.warehouseId)
      : undefined)
    .orderBy(productsTable.name, warehousesTable.name, storageLocationsTable.code);
  const report = rows.map((row) => ({
    ...row,
    inventoryValue: row.quantity * row.unitPrice,
    status: row.quantity <= 0
      ? "out"
      : row.quantity <= row.minStock
        ? "low"
        : row.maxStock > 0 && row.quantity > row.maxStock
          ? "above_maximum"
          : "normal",
  }));
  res.json(GetStockReportResponse.parse(report));
});

router.get("/reports/movements", reportReaders, async (req, res): Promise<void> => {
  const parsed = GetMovementReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let filters;
  try {
    filters = movementDateFilters(parsed.data.from, parsed.data.to);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  if (parsed.data.warehouseId) {
    filters.push(eq(warehousesTable.id, parsed.data.warehouseId));
  }
  const movements = await db.select({
    id: stockMovementsTable.id,
    productId: productsTable.id,
    productName: productsTable.name,
    type: stockMovementsTable.type,
    quantity: stockMovementsTable.quantity,
    note: stockMovementsTable.note,
    warehouseName: warehousesTable.name,
    locationName: storageLocationsTable.name,
    createdAt: stockMovementsTable.createdAt,
  }).from(stockMovementsTable)
    .innerJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
    .leftJoin(storageLocationsTable, eq(stockMovementsTable.locationId, storageLocationsTable.id))
    .leftJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(stockMovementsTable.createdAt));
  res.json(GetMovementReportResponse.parse(movements));
});

router.get("/reports/sales", reportReaders, async (req, res): Promise<void> => {
  const parsed = GetSalesReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let filters;
  try {
    filters = dateFilters(parsed.data.from, parsed.data.to);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  filters.push(eq(ordersTable.type, "out"));
  const orders = await db.select({
    id: ordersTable.id,
    totalItems: ordersTable.totalItems,
    totalValue: ordersTable.totalValue,
  }).from(ordersTable).where(and(...filters));
  const items = orders.length
    ? await db.select().from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orders.map((order) => order.id)))
    : [];
  const byProduct = new Map<number, {
    productId: number;
    productName: string;
    sku: string;
    quantity: number;
    revenue: number;
  }>();
  for (const item of items) {
    const current = byProduct.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: 0,
      revenue: 0,
    };
    current.quantity += item.quantity;
    current.revenue += item.totalValue;
    byProduct.set(item.productId, current);
  }
  const report = {
    orderCount: orders.length,
    itemCount: orders.reduce((sum, order) => sum + order.totalItems, 0),
    revenue: orders.reduce((sum, order) => sum + order.totalValue, 0),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
  };
  res.json(GetSalesReportResponse.parse(report));
});

router.get("/reports/purchases", stockReportReaders, async (req, res): Promise<void> => {
  const parsed = GetPurchaseReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let filters;
  try {
    filters = dateFilters(parsed.data.from, parsed.data.to);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  filters.push(eq(ordersTable.type, "in"), isNotNull(ordersTable.supplierId));
  const orders = await db.select({
    id: ordersTable.id,
    supplierId: ordersTable.supplierId,
    supplierName: suppliersTable.name,
    totalItems: ordersTable.totalItems,
    totalValue: ordersTable.totalValue,
  }).from(ordersTable)
    .leftJoin(suppliersTable, eq(ordersTable.supplierId, suppliersTable.id))
    .where(and(...filters));
  const items = orders.length
    ? await db.select().from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orders.map((order) => order.id)))
    : [];

  const suppliers = new Map<number, {
    supplierId: number | null;
    supplierName: string;
    orderCount: number;
    itemCount: number;
    totalValue: number;
  }>();
  const products = new Map<number, {
    productId: number;
    productName: string;
    sku: string;
    quantity: number;
    totalValue: number;
  }>();
  for (const order of orders) {
    const key = order.supplierId ?? 0;
    const current = suppliers.get(key) ?? {
      supplierId: order.supplierId,
      supplierName: order.supplierName ?? "Fornecedor removido",
      orderCount: 0,
      itemCount: 0,
      totalValue: 0,
    };
    current.orderCount += 1;
    current.itemCount += order.totalItems;
    current.totalValue += order.totalValue;
    suppliers.set(key, current);
  }
  for (const item of items) {
    const current = products.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: 0,
      totalValue: 0,
    };
    current.quantity += item.quantity;
    current.totalValue += item.totalValue;
    products.set(item.productId, current);
  }
  const report = {
    orderCount: orders.length,
    itemCount: orders.reduce((sum, order) => sum + order.totalItems, 0),
    totalValue: orders.reduce((sum, order) => sum + order.totalValue, 0),
    bySupplier: [...suppliers.values()].sort((a, b) => b.totalValue - a.totalValue),
    byProduct: [...products.values()].sort((a, b) => b.totalValue - a.totalValue),
  };
  res.json(GetPurchaseReportResponse.parse(report));
});

export default router;
