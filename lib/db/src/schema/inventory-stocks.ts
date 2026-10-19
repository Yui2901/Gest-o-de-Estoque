import { bigint, integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { storageLocationsTable } from "./warehouses";

export const inventoryStocksTable = pgTable("inventory_stocks", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  locationId: integer("location_id").notNull().references(() => storageLocationsTable.id, { onDelete: "cascade" }),
  quantity: bigint("quantity", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("inventory_stocks_product_location_unique").on(table.productId, table.locationId),
]);

export const insertInventoryStockSchema = createInsertSchema(inventoryStocksTable).omit({ id: true, updatedAt: true });
export type InsertInventoryStock = z.infer<typeof insertInventoryStockSchema>;
export type InventoryStock = typeof inventoryStocksTable.$inferSelect;
