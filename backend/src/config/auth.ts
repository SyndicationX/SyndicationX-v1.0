/**
 * Shared JWT config so login and auth middleware always use the same secret and behaviour.
 * Ensures tokens issued at login validate when verifying.
 */
const JWT_SECRET =

  typeof process.env.JWT_SECRET_KEY === "string" &&

  process.env.JWT_SECRET_KEY.trim() !== ""

    ? process.env.JWT_SECRET_KEY.trim()

    : "your-secret-key";
 
/** Short-lived access JWT (validated against DB by jti). */
const ACCESS_TOKEN_EXPIRY = "15m";

/** Long-lived opaque refresh token stored hashed in DB. */
const REFRESH_TOKEN_EXPIRY = "7d";

/** @deprecated Use getAccessTokenExpiry — kept for invite/reset JWT flows. */
const JWT_EXPIRY = "7d";

export function getJwtSecret(): string {
  return JWT_SECRET;
}

export function getAccessTokenExpiry(): string {
  return (
    process.env.JWT_ACCESS_EXPIRES_IN?.trim() || ACCESS_TOKEN_EXPIRY
  );
}

export function getRefreshTokenExpiry(): string {
  return (
    process.env.JWT_REFRESH_EXPIRES_IN?.trim() || REFRESH_TOKEN_EXPIRY
  );
}

export function getJwtExpiry(): string {
  return JWT_EXPIRY;
}
 
