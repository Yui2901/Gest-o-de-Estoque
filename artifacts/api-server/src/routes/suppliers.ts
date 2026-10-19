import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, suppliersTable } from "@workspace/db";
import {
  CreateSupplierBody,
  CreateSupplierResponse,
  DeleteSupplierParams,
  ListSuppliersResponse,
  UpdateSupplierBody,
  UpdateSupplierParams,
  UpdateSupplierResponse,
} from "@workspace/api-zod";
import { managersAndAdministrators, operationalUsers } from "../middlewares/auth";

const router: IRouter = Router();

function normalizeDocument(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.length !== 11 && digits.length !== 14) {
    throw new Error("CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos");
  }
  return digits;
}

router.get("/suppliers", operationalUsers, async (_req, res): Promise<void> => {
  const suppliers = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  res.json(ListSuppliersResponse.parse(suppliers));
});

router.post("/suppliers", managersAndAdministrators, async (req, res): Promise<void> => {
  const parsed = CreateSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let document: string | null;
  try {
    document = normalizeDocument(parsed.data.document);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const [supplier] = await db.insert(suppliersTable).values({
    name: parsed.data.name.trim(),
    phone: parsed.data.phone.trim(),
    document,
    email: parsed.data.email?.trim().toLowerCase() || null,
    address: parsed.data.address?.trim() || null,
  }).returning();
  res.status(201).json(CreateSupplierResponse.parse(supplier));
});

router.patch("/suppliers/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = UpdateSupplierParams.safeParse(req.params);
  const parsed = UpdateSupplierBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Dados inválidos para atualizar o fornecedor" });
    return;
  }
  let document: string | null | undefined;
  try {
    document = parsed.data.document === undefined ? undefined : normalizeDocument(parsed.data.document);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const [supplier] = await db.update(suppliersTable).set({
    ...parsed.data,
    ...(document !== undefined ? { document } : {}),
    ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.phone ? { phone: parsed.data.phone.trim() } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email?.trim().toLowerCase() || null } : {}),
    ...(parsed.data.address !== undefined ? { address: parsed.data.address?.trim() || null } : {}),
  }).where(eq(suppliersTable.id, params.data.id)).returning();
  if (!supplier) {
    res.status(404).json({ error: "Fornecedor não encontrado" });
    return;
  }
  res.json(UpdateSupplierResponse.parse(supplier));
});

router.delete("/suppliers/:id", managersAndAdministrators, async (req, res): Promise<void> => {
  const params = DeleteSupplierParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [supplier] = await db.delete(suppliersTable)
    .where(eq(suppliersTable.id, params.data.id))
    .returning({ id: suppliersTable.id });
  if (!supplier) {
    res.status(404).json({ error: "Fornecedor não encontrado" });
    return;
  }
  res.sendStatus(204);
});

export default router;
