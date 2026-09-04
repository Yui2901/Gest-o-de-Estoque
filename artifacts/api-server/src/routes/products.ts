import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, productsTable, stockMovementsTable } from "@workspace/db";
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

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid product payload");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .insert(productsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(CreateProductResponse.parse(formatProduct(product)));
});

router.patch("/products/:id", async (req, res): Promise<void> => {
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

router.delete("/products/:id", async (req, res): Promise<void> => {
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

router.post("/products/:id/stock", async (req, res): Promise<void> => {
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

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, params.data.id));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const nextStock =
    parsed.data.type === "in"
      ? product.stock + parsed.data.quantity
      : product.stock - parsed.data.quantity;

  if (nextStock < 0) {
    res.status(400).json({ error: "Stock cannot be negative" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    await tx.insert(stockMovementsTable).values({
      productId: product.id,
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      note: parsed.data.note ?? null,
    });

    const [nextProduct] = await tx
      .update(productsTable)
      .set({ stock: nextStock })
      .where(eq(productsTable.id, product.id))
      .returning();

    return nextProduct;
  });

  res.json(CreateStockMovementResponse.parse(formatProduct(updated)));
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

router.get("/activity", async (_req, res): Promise<void> => {
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