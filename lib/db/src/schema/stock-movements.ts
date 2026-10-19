import { bigint, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { ordersTable } from "./orders";
import { storageLocationsTable } from "./warehouses";

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "cascade" }),
  locationId: integer("location_id").references(() => storageLocationsTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  quantity: bigint("quantity", { mode: "number" }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStockMovementSchema = createInsertSchema(stockMovementsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovementsTable.$inferSelect;