import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  appUsersTable,
  db,
  userInvitationsTable,
} from "@workspace/db";
import {
  administratorOnly,
  requireAppUser,
  type AppRole,
} from "../middlewares/auth";

const router: IRouter = Router();
const validRoles: AppRole[] = ["administrator", "manager", "employee", "consultation"];

router.get("/auth/bootstrap-status", async (_req, res): Promise<void> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appUsersTable);
  res.json({ needsAdministrator: result.count === 0 });
});

router.get("/auth/me", requireAppUser, (req, res): void => {
  const user = req.appUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json(user);
});

router.get("/users", administratorOnly, async (_req, res): Promise<void> => {
  const [users, invitations] = await Promise.all([
    db.select().from(appUsersTable).orderBy(appUsersTable.createdAt),
    db.select().from(userInvitationsTable).orderBy(userInvitationsTable.createdAt),
  ]);
  res.json([
    ...users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: "active" as const,
      createdAt: user.createdAt,
    })),
    ...invitations.map((invitation) => ({
      id: -invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      status: "invited" as const,
      createdAt: invitation.createdAt,
    })),
  ]);
});

router.post("/users", administratorOnly, async (req, res): Promise<void> => {
  const { email, name, role } = req.body ?? {};
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== "string" ||
    !name.trim() ||
    !validRoles.includes(role)
  ) {
    res.status(400).json({ error: "Informe nome, e-mail válido e perfil" });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const [existingUser] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.email, normalizedEmail))
    .limit(1);
  const [existingInvitation] = await db
    .select({ id: userInvitationsTable.id })
    .from(userInvitationsTable)
    .where(eq(userInvitationsTable.email, normalizedEmail))
    .limit(1);
  if (existingUser || existingInvitation) {
    res.status(409).json({ error: "Já existe um usuário ou convite para este e-mail" });
    return;
  }

  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: normalizedEmail,
      publicMetadata: { appRole: role, appName: "Nuvem Estoque" },
      redirectUrl: "/sign-up",
    });
    const [savedInvitation] = await db
      .insert(userInvitationsTable)
      .values({
        email: normalizedEmail,
        name: name.trim(),
        role,
        clerkInvitationId: invitation.id,
      })
      .returning();
    res.status(201).json({
      id: -savedInvitation.id,
      email: savedInvitation.email,
      name: savedInvitation.name,
      role: savedInvitation.role,
      status: "invited",
      createdAt: savedInvitation.createdAt,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to invite application user");
    res.status(502).json({ error: "Não foi possível enviar o convite pelo provedor de acesso" });
  }
});

router.delete("/users/:id", administratorOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id === 0) {
    res.status(400).json({ error: "Identificador inválido" });
    return;
  }

  if (id < 0) {
    const invitationId = Math.abs(id);
    const [invitation] = await db
      .select()
      .from(userInvitationsTable)
      .where(eq(userInvitationsTable.id, invitationId))
      .limit(1);
    if (!invitation) {
      res.status(404).json({ error: "Convite não encontrado" });
      return;
    }
    try {
      await clerkClient.invitations.revokeInvitation(invitation.clerkInvitationId);
    } catch (error) {
      req.log.warn({ err: error }, "Clerk invitation could not be revoked");
    }
    await db.delete(userInvitationsTable).where(eq(userInvitationsTable.id, invitation.id));
    res.sendStatus(204);
    return;
  }

  const [user] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.id, id))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  if (user.clerkUserId === req.appUser?.clerkUserId) {
    res.status(400).json({ error: "Você não pode excluir sua própria conta" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(815433)`);
    if (user.role === "administrator") {
      const [count] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(appUsersTable)
        .where(eq(appUsersTable.role, "administrator"));
      if (count.count <= 1) return false;
    }
    await tx.delete(appUsersTable).where(eq(appUsersTable.id, user.id));
    return true;
  });
  if (!outcome) {
    res.status(400).json({ error: "Não é possível excluir o último administrador" });
    return;
  }

  try {
    await clerkClient.users.deleteUser(user.clerkUserId);
  } catch (error) {
    req.log.error({ err: error }, "Local user access was removed but Clerk account deletion failed");
    res.status(502).json({ error: "Acesso local removido, mas não foi possível excluir a conta no provedor" });
    return;
  }
  res.sendStatus(204);
});

export default router;
