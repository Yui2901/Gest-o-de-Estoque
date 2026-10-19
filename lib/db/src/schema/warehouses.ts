import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const warehousesTable = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  address: text("address"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storageLocationsTable = pgTable("storage_locations", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("storage_locations_warehouse_code_unique").on(table.warehouseId, table.code),
]);

export const insertWarehouseSchema = createInsertSchema(warehousesTable).omit({ id: true, createdAt: true });
export const insertStorageLocationSchema = createInsertSchema(storageLocationsTable).omit({ id: true, createdAt: true });
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type InsertStorageLocation = z.infer<typeof insertStorageLocationSchema>;
export type Warehouse = typeof warehousesTable.$inferSelect;
export type StorageLocation = typeof storageLocationsTable.$inferSelect;
