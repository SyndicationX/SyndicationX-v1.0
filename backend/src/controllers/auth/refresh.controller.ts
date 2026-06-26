import type { Request, Response } from "express";
import { getValidJwtUser } from "../../middleware/jwtUser.js";
import {
  refreshAuthTokens,
  revokeAccessTokenByJti,
  revokeRefreshToken,
} from "../../services/auth/token.service.js";

type RefreshBody = {
  refreshToken?: unknown;
};

/** POST /auth/refresh — rotate refresh token and issue a new access token pair. */
export async function postRefreshTokens(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as RefreshBody;
  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken : "";

  const result = await refreshAuthTokens(refreshToken, req);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  res.status(200).json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    token: result.accessToken,
  });
}

type LogoutBody = {
  refreshToken?: unknown;
};

/** POST /auth/logout — revoke current access and refresh tokens. */
export async function postAuthLogout(
  req: Request,
  res: Response,
): Promise<void> {
  const jwtUser = await getValidJwtUser(req);
  const body = req.body as LogoutBody;
  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken : "";

  if (jwtUser?.jti) {
    try {
      await revokeAccessTokenByJti(jwtUser.jti);
    } catch (err) {
      console.error("postAuthLogout revoke access:", err);
    }
  }

  if (refreshToken.trim()) {
    try {
      await revokeRefreshToken(refreshToken);
    } catch (err) {
      console.error("postAuthLogout revoke refresh:", err);
    }
  }

  res.status(200).json({ ok: true });
}
