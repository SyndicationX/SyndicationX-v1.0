/** sessionStorage key for short-lived access JWT from sign-in */
export const SESSION_BEARER_KEY = "bearerToken";

/** sessionStorage key for long-lived refresh token (stored hashed server-side). */
export const SESSION_REFRESH_KEY = "refreshToken";

/** sessionStorage key for JSON stringified `userDetails` array from sign-in API */
export const SESSION_USER_DETAILS_KEY = "userDetails";

/** `investing` | `syndicating` — survives refresh; cleared on logout. */
export const SESSION_PORTAL_MODE_KEY = "portalMode";

/** Open portal activity session id (login → logout tracking). */
export const SESSION_ACTIVITY_SESSION_ID_KEY = "activitySessionId";

/** Post-login redirect from eSign / invite email links (survives if `?next=` is dropped). */
export const AUTH_RETURN_NEXT_KEY = "authReturnNext";

/**
 * Platform admins often have no `organizationId` on session user. Workspace settings still need a
 * `companies.id` for GET/PUT — this stores the last resolved target (no UI picker).
 */
export const SESSION_WORKSPACE_COMPANY_ID_KEY = "workspaceCompanyId";

/** localStorage copy so a new tab can open signed in. Cleared on logout. */
export const PORTAL_SESSION_MIRROR_KEY = "portalSessionMirror";

/** Clears sign-in token and cached user details. Call from client-only code (e.g. logout). */
export function clearPortalSessionStorage(): void {
  const mine = sessionStorage.getItem(SESSION_BEARER_KEY)
  sessionStorage.removeItem(SESSION_BEARER_KEY)
  sessionStorage.removeItem(SESSION_REFRESH_KEY)
  sessionStorage.removeItem(SESSION_USER_DETAILS_KEY)
  sessionStorage.removeItem(SESSION_WORKSPACE_COMPANY_ID_KEY)
  sessionStorage.removeItem(SESSION_PORTAL_MODE_KEY)
  sessionStorage.removeItem(SESSION_ACTIVITY_SESSION_ID_KEY)
  sessionStorage.removeItem(AUTH_RETURN_NEXT_KEY)
  try {
    const raw = localStorage.getItem(PORTAL_SESSION_MIRROR_KEY)
    if (!raw) return
    if (!mine) {
      localStorage.removeItem(PORTAL_SESSION_MIRROR_KEY)
      return
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const mirrorValue = parsed?.[SESSION_BEARER_KEY]
    const mirrorToken = typeof mirrorValue === "string" ? mirrorValue : ""
    // A duplicated tab can sign out on a stale token while another tab already
    // published a newer sign-in. Leave that newer copy in place.
    if (!mirrorToken || mirrorToken === mine) {
      localStorage.removeItem(PORTAL_SESSION_MIRROR_KEY)
    }
  } catch {
    /* private mode / blocked storage */
  }
}
