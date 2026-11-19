import { randomUUID } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../../database/db.js";
import {
  getAccessTokenExpiry,
  getJwtSecret,
  getRefreshTokenExpiry,
} from "../../config/auth.js";
import { userAuthTokens } from "../../schema/auth.schema/userAuthTokens.schema.js";
import { users } from "../../schema/schema.js";
import { generateOpaqueToken, hashToken } from "../../utils/tokenHash.js";

export type IssuedAuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenId: string;
  refreshTokenId: string;
};

export type TokenIssueContext = {
  userId: string;
  email: string;
  userRole: string;
  portalSessionId?: string;
  req?: Request;
};

function parseExpiryToMs(expiry: string): number {
  const m = /^(\d+)([smhd])$/.exec(expiry.trim());
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  switch (m[2]) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

function expiresAtFromConfig(expiry: string): Date {
  return new Date(Date.now() + parseExpiryToMs(expiry));
}

function clientMeta(req?: Request): { userAgent: string | null; clientIp: string | null } {
  if (!req) return { userAgent: null, clientIp: null };
  const userAgent =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"].slice(0, 2000)
      : null;
  const forwarded = req.headers["x-forwarded-for"];
  let clientIp: string | null = null;
  if (typeof forwarded === "string" && forwarded.trim()) {
    clientIp = forwarded.split(",")[0]?.trim().slice(0, 128) ?? null;
  } else if (typeof req.socket?.remoteAddress === "string") {
    clientIp = req.socket.remoteAddress.slice(0, 128);
  }
  return { userAgent, clientIp };
}

/** Issue access + refresh tokens and persist both in the database. */
export async function issueAuthTokenPair(
  ctx: TokenIssueContext,
): Promise<IssuedAuthTokens> {
  const accessJti = randomUUID();
  const refreshRaw = generateOpaqueToken();
  const accessExpiresAt = expiresAtFromConfig(getAccessTokenExpiry());
  const refreshExpiresAt = expiresAtFromConfig(getRefreshTokenExpiry());
  const { userAgent, clientIp } = clientMeta(ctx.req);

  const accessToken = jwt.sign(
    {
      id: ctx.userId,
      email: ctx.email,
      userRole: ctx.userRole,
      jti: accessJti,
      typ: "access",
    },
    getJwtSecret(),
    { expiresIn: getAccessTokenExpiry() } as SignOptions,
  );

  const [accessRow] = await db
    .insert(userAuthTokens)
    .values({
      userId: ctx.userId,
      tokenType: "access",
      tokenHash: hashToken(accessJti),
      expiresAt: accessExpiresAt,
      portalSessionId: ctx.portalSessionId ?? null,
      userAgent,
      clientIp,
    })
    .returning({ id: userAuthTokens.id });

  const [refreshRow] = await db
    .insert(userAuthTokens)
    .values({
      userId: ctx.userId,
      tokenType: "refresh",
      tokenHash: hashToken(refreshRaw),
      expiresAt: refreshExpiresAt,
      portalSessionId: ctx.portalSessionId ?? null,
      userAgent,
      clientIp,
    })
    .returning({ id: userAuthTokens.id });

  if (!accessRow?.id || !refreshRow?.id) {
    throw new Error("Failed to persist auth tokens");
  }

  return {
    accessToken,
    refreshToken: refreshRaw,
    accessTokenId: accessRow.id,
    refreshTokenId: refreshRow.id,
  };
}

export const ACCESS_UPDATED_AUTH_CODE = "access_updated";
export const ACCESS_UPDATED_AUTH_MESSAGE =
  "Your access was updated. Sign in again.";

export type AccessTokenState = "active" | "inactive" | "access_updated";

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; message: string; code?: string };

/** Validate refresh token, rotate it, and return a new token pair. */
export async function refreshAuthTokens(
  rawRefreshToken: string,
  req?: Request,
): Promise<RefreshResult> {
  const trimmed = rawRefreshToken.trim();
  if (!trimmed) {
    return { ok: false, status: 401, message: "Refresh token is required" };
  }

  const tokenHash = hashToken(trimmed);
  const now = new Date();

  const [row] = await db
    .select()
    .from(userAuthTokens)
    .where(
      and(
        eq(userAuthTokens.tokenHash, tokenHash),
        eq(userAuthTokens.tokenType, "refresh"),
        isNull(userAuthTokens.revokedAt),
      ),
    )
    .limit(1);

  if (!row) {
    if (await revokedRefreshWasAccessUpdate(tokenHash)) {
      return {
        ok: false,
        status: 401,
        code: ACCESS_UPDATED_AUTH_CODE,
        message: ACCESS_UPDATED_AUTH_MESSAGE,
      };
    }
    return { ok: false, status: 401, message: "Invalid or expired refresh token" };
  }
  if (row.expiresAt <= now) {
    await db
      .update(userAuthTokens)
      .set({ revokedAt: now })
      .where(eq(userAuthTokens.id, row.id));
    return { ok: false, status: 401, message: "Refresh token has expired" };
  }

  const [userRow] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      userStatus: users.userStatus,
      sessionInvalidAfter: users.sessionInvalidAfter,
    })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!userRow) {
    return { ok: false, status: 401, message: "User not found" };
  }

  if (
    userRow.sessionInvalidAfter &&
    row.createdAt < userRow.sessionInvalidAfter
  ) {
    await revokeAllUserAuthTokens(row.userId);
    return {
      ok: false,
      status: 401,
      code: ACCESS_UPDATED_AUTH_CODE,
      message: ACCESS_UPDATED_AUTH_MESSAGE,
    };
  }

  const status = String(userRow.userStatus ?? "").trim().toLowerCase();
  if (status !== "active") {
    await revokeAllUserAuthTokens(row.userId);
    return {
      ok: false,
      status: 403,
      message: "Your account is not active. Please sign in again.",
    };
  }

  const newPair = await issueAuthTokenPair({
    userId: row.userId,
    email: userRow.email,
    userRole: userRow.role,
    portalSessionId: row.portalSessionId ?? undefined,
    req,
  });

  await db
    .update(userAuthTokens)
    .set({ revokedAt: now, replacedById: newPair.refreshTokenId })
    .where(eq(userAuthTokens.id, row.id));

  return {
    ok: true,
    accessToken: newPair.accessToken,
    refreshToken: newPair.refreshToken,
  };
}

/**
 * Access-token state for API auth.
 * An admin access change revokes the token and sets `sessionInvalidAfter`, so that
 * case is reported even when the row is already revoked.
 */
export async function getAccessTokenState(jti: string): Promise<AccessTokenState> {
  const trimmed = jti.trim();
  if (!trimmed) return "inactive";

  const [row] = await db
    .select({
      expiresAt: userAuthTokens.expiresAt,
      createdAt: userAuthTokens.createdAt,
      revokedAt: userAuthTokens.revokedAt,
      sessionInvalidAfter: users.sessionInvalidAfter,
    })
    .from(userAuthTokens)
    .innerJoin(users, eq(users.id, userAuthTokens.userId))
    .where(
      and(
        eq(userAuthTokens.tokenHash, hashToken(trimmed)),
        eq(userAuthTokens.tokenType, "access"),
      ),
    )
    .limit(1);

  if (!row) return "inactive";
  if (row.sessionInvalidAfter && row.createdAt < row.sessionInvalidAfter) {
    return "access_updated";
  }
  if (row.revokedAt) return "inactive";
  if (row.expiresAt <= new Date()) return "inactive";
  return "active";
}

/** True when the access token jti is present, unexpired, and not revoked. */
export async function isAccessTokenActive(jti: string): Promise<boolean> {
  return (await getAccessTokenState(jti)) === "active";
}

async function revokedRefreshWasAccessUpdate(tokenHash: string): Promise<boolean> {
  const [row] = await db
    .select({
      userId: userAuthTokens.userId,
      createdAt: userAuthTokens.createdAt,
      revokedAt: userAuthTokens.revokedAt,
    })
    .from(userAuthTokens)
    .where(
      and(
        eq(userAuthTokens.tokenHash, tokenHash),
        eq(userAuthTokens.tokenType, "refresh"),
      ),
    )
    .limit(1);
  if (!row?.revokedAt) return false;

  const [userRow] = await db
    .select({ sessionInvalidAfter: users.sessionInvalidAfter })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  return Boolean(
    userRow?.sessionInvalidAfter && row.createdAt < userRow.sessionInvalidAfter,
  );
}

export async function revokeAllUserAuthTokens(userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(userAuthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(userAuthTokens.userId, userId),
        isNull(userAuthTokens.revokedAt),
      ),
    );
}

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const trimmed = rawRefreshToken.trim();
  if (!trimmed) return;
  const now = new Date();
  await db
    .update(userAuthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(userAuthTokens.tokenHash, hashToken(trimmed)),
        eq(userAuthTokens.tokenType, "refresh"),
        isNull(userAuthTokens.revokedAt),
      ),
    );
}

export async function linkPortalSessionToAuthTokens(
  accessTokenId: string,
  refreshTokenId: string,
  portalSessionId: string,
): Promise<void> {
  const sessionId = portalSessionId.trim();
  if (!sessionId) return;
  await db
    .update(userAuthTokens)
    .set({ portalSessionId: sessionId })
    .where(
      and(
        isNull(userAuthTokens.revokedAt),
        inArray(userAuthTokens.id, [accessTokenId, refreshTokenId]),
      ),
    );
}

export async function revokeAccessTokenByJti(jti: string): Promise<void> {
  const trimmed = jti.trim();
  if (!trimmed) return;
  const now = new Date();
  await db
    .update(userAuthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(userAuthTokens.tokenHash, hashToken(trimmed)),
        eq(userAuthTokens.tokenType, "access"),
        isNull(userAuthTokens.revokedAt),
      ),
    );
}
