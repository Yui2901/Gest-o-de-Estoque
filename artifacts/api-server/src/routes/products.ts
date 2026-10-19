import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  inventoryStocksTable,
  productsTable,
  stockMovementsTable,
  storageLocationsTable,
  warehousesTable,
} from "@workspace/db";
import {
  CreateProductBody,
  CreateProductResponse,
  CreateStockMovementBody,
  CreateStockMovementParams,
  CreateStockMovementResponse,
  DeleteProductParams,
  GetDashboardSummaryResponse,
  ListActivityResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import { managersAndAdministrators, operationalUsers } from "../middlewares/auth";

const router: IRouter = Router();

type Accent = "pink" | "orange";
type Status = "normal" | "low" | "out";

function getStatus(stock: number, minStock: number): Status {
  if (stock <= 0) return "out";
  if (stock <= minStock) return "low";
  return "normal";
}

function formatProduct(product: typeof productsTable.$inferSelect) {
  return {
    ...product,
    accent: product.accent as Accent,
    status: getStatus(product.stock, product.minStock),
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid product filters");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [];
  if (parsed.data.search) {
    filters.push(
      or(
        ilike(productsTable.name, `%${parsed.data.search}%`),
        ilike(productsTable.sku, `%${parsed.data.search}%`),
      ),
    );
  }
  if (parsed.data.category) {
    filters.push(eq(productsTable.category, parsed.data.category));
  }

  const rows = await db
    .select()
    .from(productsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(productsTable.updatedAt));

  const products = rows
    .map(formatProduct)
    .filter((product) => {
      if (!parsed.data.status || parsed.data.status === "all") return true;
      return product.status === parsed.data.status;
    });

  res.json(ListProductsResponse.parse(products));
});

router.post("/products", managersAndAdministrators, async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid product payload");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const product = await db.transaction(async (tx) => {
      const { locationId, ...input } = parsed.data;
      const locationRows = await tx.select({
        id: storageLocationsTable.id,
      }).from(storageLocationsTable)
        .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
        .where(locationId
          ? and(eq(storageLocationsTable.id, locationId), eq(warehousesTable.active, true))
          : eq(warehousesTable.active, true))
        .orderBy(storageLocationsTable.id)
        .limit(1);
      const location = locationRows[0];
      if (!location) throw new Error("Cadastre um estoque e uma localização ativa antes de incluir produtos");
      const [created] = await tx.insert(productsTable).values({
        ...input,
        maxStock: input.maxStock ?? 0,
      }).returning();
      await tx.insert(inventoryStocksTable).values({
        productId: created.id,
        locationId: location.id,
        quantity: created.stock,
      });
      return created;
    });
    res.status(201).json(CreateProductResponse.parse(formatProduct(product)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível cadastrar o produto";
    req.log.error({ err: error }, "Failed to create product");
    res.status(message.includes("duplicate") ? 409 : 400).json({ error: message });
  }
});

router.patch("/products/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid product update");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .update(productsTable)
    .set(parsed.data)
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(UpdateProductResponse.parse(formatProduct(product)));
});

router.delete("/products/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [product] = await db
    .delete(productsTable)
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/products/:id/stock", operationalUsers, async (req, res): Promise<void> => {
  const params = CreateStockMovementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateStockMovementBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid stock movement");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { type, quantity, locationId, note } = parsed.data;
  if (req.appUser?.role === "employee" && type !== "in") {
    res.status(403).json({ error: "Funcionários podem registrar entradas; saídas devem ser registradas como venda" });
    return;
  }
  if ((type === "in" || type === "out") && quantity <= 0) {
    res.status(400).json({ error: "Entradas e saídas precisam ter quantidade positiva" });
    return;
  }
  if (type === "adjustment" && quantity === 0) {
    res.status(400).json({ error: "O ajuste precisa alterar o saldo" });
    return;
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const [product] = await tx.select().from(productsTable)
        .where(eq(productsTable.id, params.data.id)).for("update");
      if (!product) throw new Error("Produto não encontrado");
      const locationRows = await tx.select({
        id: storageLocationsTable.id,
      }).from(storageLocationsTable)
        .innerJoin(warehousesTable, eq(storageLocationsTable.warehouseId, warehousesTable.id))
        .where(locationId
          ? and(eq(storageLocationsTable.id, locationId), eq(warehousesTable.active, true))
          : eq(warehousesTable.active, true))
        .orderBy(storageLocationsTable.id)
        .limit(1);
      const location = locationRows[0];
      if (!location) throw new Error("Localização ativa não encontrada");
      const [balance] = await tx.select().from(inventoryStocksTable)
        .where(and(
          eq(inventoryStocksTable.productId, product.id),
          eq(inventoryStocksTable.locationId, location.id),
        )).limit(1);
      const currentAtLocation = balance?.quantity ?? 0;
      const delta = type === "in" ? quantity : type === "out" ? -quantity : quantity;
      const nextLocationStock = currentAtLocation + delta;
      const nextStock = product.stock + delta;
      if (nextLocationStock < 0 || nextStock < 0) throw new Error("O estoque não pode ficar negativo");
      if (balance) {
        await tx.update(inventoryStocksTable).set({ quantity: nextLocationStock })
          .where(eq(inventoryStocksTable.id, balance.id));
      } else {
        await tx.insert(inventoryStocksTable).values({
          productId: product.id,
          locationId: location.id,
          quantity: nextLocationStock,
        });
      }
      await tx.insert(stockMovementsTable).values({
        productId: product.id,
        locationId: location.id,
        type,
        quantity: type === "adjustment" ? delta : quantity,
        note: note ?? null,
      });
      const [nextProduct] = await tx.update(productsTable)
        .set({ stock: sql`${productsTable.stock} + ${delta}` })
        .where(eq(productsTable.id, product.id))
        .returning();
      return nextProduct;
    });
    res.json(CreateStockMovementResponse.parse(formatProduct(updated)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível alterar o estoque";
    res.status(message.includes("não encontrado") ? 404 : 400).json({ error: message });
  }
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable);
  const summary = {
    totalProducts: products.length,
    totalUnits: products.reduce((total, product) => total + product.stock, 0),
    lowStock: products.filter(
      (product) => product.stock > 0 && product.stock <= product.minStock,
    ).length,
    outOfStock: products.filter((product) => product.stock <= 0).length,
    inventoryValue: products.reduce(
      (total, product) => total + product.unitPrice * product.stock,
      0,
    ),
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/activity", managersAndAdministrators, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: stockMovementsTable.id,
      productName: productsTable.name,
      type: stockMovementsTable.type,
      quantity: stockMovementsTable.quantity,
      note: stockMovementsTable.note,
      createdAt: stockMovementsTable.createdAt,
    })
    .from(stockMovementsTable)
    .innerJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
    .orderBy(desc(stockMovementsTable.createdAt))
    .limit(12);

  res.json(ListActivityResponse.parse(rows));
});

export default router;