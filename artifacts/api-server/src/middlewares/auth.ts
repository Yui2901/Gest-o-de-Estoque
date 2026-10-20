import { getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { clerkClient } from "@clerk/express";
import {
  appUsersTable,
  db,
  userInvitationsTable,
  type AppUser,
} from "@workspace/db";

export type AppRole = "administrator" | "manager" | "employee" | "consultation";

declare global {
  namespace Express {
    interface Request {
      appUser?: AppUser;
    }
  }
}

class AccessDeniedError extends Error {}

async function resolveAppUser(clerkUserId: string): Promise<AppUser> {
  const [existing] = await db.select().from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId)).limit(1);
  if (existing) {
    if (existing.name !== existing.email) return existing;
    try {
      const identity = await clerkClient.users.getUser(clerkUserId);
      const registrationName = identity.unsafeMetadata?.appFullName;
      const identityName = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
      const name = typeof registrationName === "string" && registrationName.trim()
        ? registrationName.trim()
        : identity.fullName?.trim() || identityName;
      if (!name) return existing;
      const [updated] = await db.update(appUsersTable)
        .set({ name })
        .where(eq(appUsersTable.id, existing.id))
        .returning();
      return updated ?? existing;
    } catch {
      return existing;
    }
  }

  const identity = await clerkClient.users.getUser(clerkUserId);
  const emailRecord = identity.emailAddresses.find(
    (email) => email.id === identity.primaryEmailAddressId,
  );
  if (!emailRecord || emailRecord.verification?.status !== "verified") {
    throw new AccessDeniedError("A verified primary email is required");
  }
  const email = emailRecord.emailAddress.trim().toLowerCase();
  const registrationName = identity.unsafeMetadata?.appFullName;
  const identityName = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  const name = typeof registrationName === "string" && registrationName.trim()
    ? registrationName.trim()
    : identity.fullName?.trim() || identityName;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(815432)`);
    const [racedUser] = await tx.select().from(appUsersTable)
      .where(eq(appUsersTable.clerkUserId, clerkUserId)).limit(1);
    if (racedUser) return racedUser;

    const [invitation] = await tx.select().from(userInvitationsTable)
      .where(eq(userInvitationsTable.email, email)).limit(1);
    let role: AppRole;
    if (invitation) {
      role = invitation.role as AppRole;
    } else {
      const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(appUsersTable);
      if (count.count !== 0) throw new AccessDeniedError("This account has not been invited");
      role = "administrator";
    }
    const storedName = invitation?.name?.trim() || name;
    if (!storedName) {
      throw new AccessDeniedError("Informe seu nome completo no cadastro para acessar o sistema");
    }

    const [created] = await tx.insert(appUsersTable)
      .values({ clerkUserId, email, name: storedName, role })
      .returning();
    if (invitation) {
      await tx.delete(userInvitationsTable).where(eq(userInvitationsTable.id, invitation.id));
    }
    return created;
  });
}

export async function requireAppUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.appUser = await resolveAppUser(userId);
    next();
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      res.status(403).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not resolve application user");
    res.status(500).json({ error: "Unable to verify access" });
  }
}

export function requireRoles(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.appUser || !roles.includes(req.appUser.role as AppRole)) {
      res.status(403).json({ error: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
}

export const administratorOnly = requireRoles("administrator");
export const managersAndAdministrators = requireRoles("administrator", "manager");
export const operationalUsers = requireRoles("administrator", "manager", "employee");
