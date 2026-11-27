import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getApiV1Base } from "../utils/apiBaseUrl";
import {
  ensureValidAccessToken,
  handleAuthSessionExpired,
  PORTAL_SKIP_ACTIVITY_HEADER,
} from "./portalFetch";
import { parseSafeNextPath } from "./parseSafeNextPath";
import { requestPortalSessionFromOpenTab } from "./sessionTabHandoff";
import { AUTH_RETURN_NEXT_KEY, SESSION_BEARER_KEY } from "./sessionKeys";
import { useIdleLogout } from "./useIdleLogout";

/** How often to notice a revoked session after an admin changes access. */
const ACCESS_SESSION_CHECK_MS = 2_000;

function IdleSessionGuard() {
  useIdleLogout();
  return null;
}

function AuthBootstrap() {
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await ensureValidAccessToken();
      if (!cancelled && !ok && sessionStorage.getItem(SESSION_BEARER_KEY)) {
        handleAuthSessionExpired();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.key]);

  useEffect(() => {
    const base = getApiV1Base();
    if (!base) return;
    const checkSession = () => {
      if (!sessionStorage.getItem(SESSION_BEARER_KEY)) return;
      void (async () => {
        // Renew the 15-minute access token without counting this poll as activity.
        // A revoked session still fails refresh and /auth/me ends the sign-in.
        await ensureValidAccessToken({ touchActivity: false });
        if (!sessionStorage.getItem(SESSION_BEARER_KEY)) return;
        void fetch(`${base}/auth/me`, {
          method: "GET",
          headers: {
            [PORTAL_SKIP_ACTIVITY_HEADER]: "1",
          },
        });
      })();
    };
    checkSession();
    const timer = window.setInterval(checkSession, ACCESS_SESSION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

/** Wait until this tab has a sign-in, including one copied from a duplicated tab. */
export function usePortalSessionGate(): "pending" | "in" | "out" {
  const [sessionGate, setSessionGate] = useState<"pending" | "in" | "out">(() =>
    sessionStorage.getItem(SESSION_BEARER_KEY)?.trim() ? "in" : "pending",
  );

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_BEARER_KEY)?.trim()) {
      setSessionGate("in");
      return;
    }
    let cancelled = false;
    void requestPortalSessionFromOpenTab().then((ok) => {
      if (!cancelled) setSessionGate(ok ? "in" : "out");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return sessionGate;
}

/** Wraps routes that require a valid session (JWT in sessionStorage). */
export function RequireAuth() {
  const location = useLocation();
  const sessionGate = usePortalSessionGate();

  if (sessionGate === "pending") return null;

  const token = sessionStorage.getItem(SESSION_BEARER_KEY);
  if (!token) {
    const returnPath = `${location.pathname}${location.search}`;
    const safeNext = parseSafeNextPath(returnPath);
    if (safeNext) {
      sessionStorage.setItem(AUTH_RETURN_NEXT_KEY, safeNext);
      return (
        <Navigate
          to={`/signin?next=${encodeURIComponent(safeNext)}`}
          replace
          state={{ from: safeNext }}
        />
      );
    }
    return <Navigate to="/signin" replace />;
  }
  return (
    <>
      <AuthBootstrap />
      <IdleSessionGuard />
      <Outlet />
    </>
  );
}
