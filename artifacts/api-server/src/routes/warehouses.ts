import { Router, type IRouter } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  inventoryStocksTable,
  productsTable,
  storageLocationsTable,
  warehousesTable,
} from "@workspace/db";
import {
  CreateLocationBody,
  CreateWarehouseBody,
  DeleteLocationParams,
  DeleteWarehouseParams,
  ListInventoryQueryParams,
  ListInventoryResponse,
  ListLocationsQueryParams,
  ListLocationsResponse,
  ListWarehousesResponse,
  UpdateLocationBody,
  UpdateLocationParams,
  UpdateLocationResponse,
  UpdateWarehouseBody,
  UpdateWarehouseParams,
  UpdateWarehouseResponse,
} from "@workspace/api-zod";
import { managersAndAdministrators } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/warehouses", async (_req, res): Promise<void> => {
  const rows = await db.select().from(warehousesTable).orderBy(warehousesTable.name);
  res.json(ListWarehousesResponse.parse(rows));
});

router.post("/warehouses", managersAndAdministrators, async (req, res): Promise<void> => {
  const parsed = CreateWarehouseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [warehouse] = await db.insert(warehousesTable).values({
    ...parsed.data,
    code: parsed.data.code.trim().toUpperCase(),
    name: parsed.data.name.trim(),
    address: parsed.data.address?.trim() || null,
  }).returning();
  res.status(201).json(warehouse);
});

router.patch("/warehouses/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = UpdateWarehouseParams.safeParse(req.params);
  const body = UpdateWarehouseBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data ?? {}).length === 0) {
    res.status(400).json({ error: "Dados inválidos para atualizar o estoque" });
    return;
  }
  const update = {
    ...body.data,
    ...(body.data.code ? { code: body.data.code.trim().toUpperCase() } : {}),
    ...(body.data.name ? { name: body.data.name.trim() } : {}),
    ...(body.data.address !== undefined ? { address: body.data.address?.trim() || null } : {}),
  };
  const [warehouse] = await db.update(warehousesTable)
    .set(update)
    .where(eq(warehousesTable.id, params.data.id))
    .returning();
  if (!warehouse) {
    res.status(404).json({ error: "Estoque não encontrado" });
    return;
  }
  res.json(UpdateWarehouseResponse.parse(warehouse));
});

router.delete("/warehouses/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = DeleteWarehouseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [occupied] = await db.select({ count: sql<number>`count(*)::int` })
    .from(inventoryStocksTable)
    .innerJoin(storageLocationsTable, eq(inventoryStocksTable.locationId, storageLocationsTable.id))
    .where(and(eq(storageLocationsTable.warehouseId, params.data.id), gt(inventoryStocksTable.quantity, 0)));
  if (occupied.count > 0) {
    res.status(409).json({ error: "Transfira o estoque antes de excluir este local" });
    return;
  }
  const [warehouse] = await db.delete(warehousesTable)
    .where(eq(warehousesTable.id, params.data.id))
    .returning({ id: warehousesTable.id });
  if (!warehouse) {
    res.status(404).json({ error: "Estoque não encontrado" });
    return;
  }
  res.sendStatus(204);
});

router.get("/locations", async (req, res): Promise<void> => {
  const parsed = ListLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db.select({
    id: storageLocationsTable.id,
    warehouseId: storageLocationsTable.warehouseId,
    warehouseName: warehousesTable.name,
    name: storageLocationsTable.name,
    code: storageLocationsTable.code,
    description: storageLocationsTable.description,
    createdAt: storageLocationsTable.createdAt,
  }).from(storageLocationsTable)
    .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
    .where(parsed.data.warehouseId ? eq(storageLocationsTable.warehouseId, parsed.data.warehouseId) : undefined)
    .orderBy(warehousesTable.name, storageLocationsTable.code);
  res.json(ListLocationsResponse.parse(rows));
});

router.post("/locations", managersAndAdministrators, async (req, res): Promise<void> => {
  const parsed = CreateLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [warehouse] = await db.select().from(warehousesTable)
    .where(and(eq(warehousesTable.id, parsed.data.warehouseId), eq(warehousesTable.active, true)))
    .limit(1);
  if (!warehouse) {
    res.status(400).json({ error: "Selecione um estoque ativo" });
    return;
  }
  const [location] = await db.insert(storageLocationsTable).values({
    ...parsed.data,
    name: parsed.data.name.trim(),
    code: parsed.data.code.trim().toUpperCase(),
    description: parsed.data.description?.trim() || null,
  }).returning();
  res.status(201).json({
    ...location,
    warehouseName: warehouse.name,
  });
});

router.patch("/locations/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  const body = UpdateLocationBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data ?? {}).length === 0) {
    res.status(400).json({ error: "Dados inválidos para atualizar a localização" });
    return;
  }
  if (body.data.warehouseId !== undefined) {
    const [warehouse] = await db.select().from(warehousesTable)
      .where(and(eq(warehousesTable.id, body.data.warehouseId), eq(warehousesTable.active, true)))
      .limit(1);
    if (!warehouse) {
      res.status(400).json({ error: "Selecione um estoque ativo" });
      return;
    }
  }
  const [location] = await db.update(storageLocationsTable)
    .set({
      ...body.data,
      ...(body.data.name ? { name: body.data.name.trim() } : {}),
      ...(body.data.code ? { code: body.data.code.trim().toUpperCase() } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description?.trim() || null } : {}),
    })
    .where(eq(storageLocationsTable.id, params.data.id))
    .returning();
  if (!location) {
    res.status(404).json({ error: "Localização não encontrada" });
    return;
  }
  const [warehouse] = await db.select({ name: warehousesTable.name })
    .from(warehousesTable).where(eq(warehousesTable.id, location.warehouseId));
  res.json(UpdateLocationResponse.parse({ ...location, warehouseName: warehouse?.name ?? "" }));
});

router.delete("/locations/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = DeleteLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [occupied] = await db.select({ count: sql<number>`count(*)::int` })
    .from(inventoryStocksTable)
    .where(and(eq(inventoryStocksTable.locationId, params.data.id), gt(inventoryStocksTable.quantity, 0)));
  if (occupied.count > 0) {
    res.status(409).json({ error: "Transfira o estoque antes de excluir esta localização" });
    return;
  }
  const [location] = await db.delete(storageLocationsTable)
    .where(eq(storageLocationsTable.id, params.data.id))
    .returning({ id: storageLocationsTable.id });
  if (!location) {
    res.status(404).json({ error: "Localização não encontrada" });
    return;
  }
  res.sendStatus(204);
});

router.get("/inventory", async (req, res): Promise<void> => {
  const parsed = ListInventoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [];
  if (parsed.data.productId) filters.push(eq(inventoryStocksTable.productId, parsed.data.productId));
  if (parsed.data.warehouseId) filters.push(eq(storageLocationsTable.warehouseId, parsed.data.warehouseId));
  const rows = await db.select({
    id: inventoryStocksTable.id,
    productId: productsTable.id,
    productName: productsTable.name,
    sku: productsTable.sku,
    unitPrice: productsTable.unitPrice,
    warehouseId: warehousesTable.id,
    warehouseName: warehousesTable.name,
    locationId: storageLocationsTable.id,
    locationName: storageLocationsTable.name,
    quantity: inventoryStocksTable.quantity,
    minStock: productsTable.minStock,
    maxStock: productsTable.maxStock,
  }).from(inventoryStocksTable)
    .innerJoin(productsTable, eq(inventoryStocksTable.productId, productsTable.id))
    .innerJoin(storageLocationsTable, eq(inventoryStocksTable.locationId, storageLocationsTable.id))
    .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(inventoryStocksTable.updatedAt));
  res.json(ListInventoryResponse.parse(rows.map((row) => ({
    ...row,
    inventoryValue: row.quantity * row.unitPrice,
  }))));
});

export default router;
