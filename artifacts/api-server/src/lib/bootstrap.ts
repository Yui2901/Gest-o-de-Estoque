import { eq, isNull } from "drizzle-orm";
import {
  db,
  inventoryStocksTable,
  productsTable,
  storageLocationsTable,
  warehousesTable,
} from "@workspace/db";

export async function ensureBusinessDefaults(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(warehousesTable).values({
      name: "Estoque principal",
      code: "PRINCIPAL",
      active: true,
    }).onConflictDoNothing();
    const [warehouse] = await tx.select().from(warehousesTable)
      .where(eq(warehousesTable.code, "PRINCIPAL")).limit(1);
    if (!warehouse) throw new Error("Não foi possível preparar o estoque principal");

    await tx.insert(storageLocationsTable).values({
      warehouseId: warehouse.id,
      name: "Estoque geral",
      code: "GERAL",
    }).onConflictDoNothing();
    const [location] = await tx.select().from(storageLocationsTable)
      .where(eq(storageLocationsTable.warehouseId, warehouse.id)).limit(1);
    if (!location) throw new Error("Não foi possível preparar a localização padrão");

    const productsWithoutLocations = await tx.select({
      id: productsTable.id,
      stock: productsTable.stock,
    }).from(productsTable)
      .leftJoin(inventoryStocksTable, eq(inventoryStocksTable.productId, productsTable.id))
      .where(isNull(inventoryStocksTable.id));
    if (productsWithoutLocations.length) {
      await tx.insert(inventoryStocksTable).values(productsWithoutLocations.map((product) => ({
        productId: product.id,
        locationId: location.id,
        quantity: product.stock,
      }))).onConflictDoNothing();
    }
  });
}
