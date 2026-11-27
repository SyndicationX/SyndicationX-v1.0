/** Inactivity limit before automatic sign-out (30 minutes with no user activity). */
import { toast } from "../components/Toast/toastStore";

let mirrorSessionActivity: (() => void) | null = null;

/** Lets the new-tab session copy update without a circular import. */
export function registerSessionActivityMirror(mirror: () => void): void {
  mirrorSessionActivity = mirror;
}

export const IDLE_LOGOUT_MS = 30 * 60 * 1000;

export const SESSION_LAST_ACTIVITY_KEY = "lastActivityAt";

/** Set before redirecting to sign-in after idle logout; triggers session timeout toast. */
export const SESSION_IDLE_TIMEOUT_NOTICE_KEY = "idleSessionTimeoutNotice";

/** Set when an admin access change ends the session. */
export const SESSION_SIGNED_OUT_NOTICE_KEY = "sessionSignedOutNotice";

/** One sign-out reason so the sign-in page shows only the matching toast. */
export const SESSION_SIGNOUT_REASON_KEY = "sessionSignOutReason";

export type SessionSignOutReason = "idle" | "access_updated";

let signOutToastShownThisLoad = false;

function writeSignOutReason(reason: SessionSignOutReason): void {
  if (typeof sessionStorage === "undefined") return;
  const current = sessionStorage.getItem(SESSION_SIGNOUT_REASON_KEY);
  if (current === "idle" && reason !== "idle") return;
  if (current === "access_updated" && reason !== "access_updated") return;
  sessionStorage.setItem(SESSION_SIGNOUT_REASON_KEY, reason);
  sessionStorage.removeItem(SESSION_IDLE_TIMEOUT_NOTICE_KEY);
  sessionStorage.removeItem(SESSION_SIGNED_OUT_NOTICE_KEY);
}

export function markIdleSessionTimeoutNotice(): void {
  writeSignOutReason("idle");
}

export function markAccessUpdatedSignOutNotice(): void {
  writeSignOutReason("access_updated");
}

function peekSignOutReason(fromNavigation: boolean): SessionSignOutReason | null {
  if (typeof sessionStorage === "undefined") {
    return fromNavigation ? "idle" : null;
  }
  const stored = sessionStorage.getItem(SESSION_SIGNOUT_REASON_KEY);
  if (stored === "idle" || stored === "access_updated") return stored;
  if (
    fromNavigation ||
    sessionStorage.getItem(SESSION_IDLE_TIMEOUT_NOTICE_KEY) === "1"
  ) {
    return "idle";
  }
  if (sessionStorage.getItem(SESSION_SIGNED_OUT_NOTICE_KEY) === "1") {
    return "access_updated";
  }
  return null;
}

function clearSignOutReason(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(SESSION_SIGNOUT_REASON_KEY);
  sessionStorage.removeItem(SESSION_IDLE_TIMEOUT_NOTICE_KEY);
  sessionStorage.removeItem(SESSION_SIGNED_OUT_NOTICE_KEY);
}

function showSignOutToast(reason: SessionSignOutReason): void {
  if (reason === "idle") {
    toast.warning(
      "Session timed out",
      "You were signed out after 30 minutes of inactivity. Sign in again to continue.",
      8000,
    );
    return;
  }
  toast.warning(
    "Signed out",
    "Your access was updated. Sign in again to continue.",
    8000,
  );
}

/** Show the idle-timeout toast only when this sign-out was the 30-minute idle timeout. */
export function showIdleSessionTimeoutToastIfNeeded(
  fromNavigation = false,
): boolean {
  if (signOutToastShownThisLoad) return false;
  if (peekSignOutReason(fromNavigation) !== "idle") return false;

  signOutToastShownThisLoad = true;
  clearSignOutReason();
  showSignOutToast("idle");
  return true;
}

/** Show the access-updated toast only when an admin change ended the session. */
export function showSignedOutNoticeIfNeeded(): boolean {
  if (signOutToastShownThisLoad) return false;
  if (peekSignOutReason(false) !== "access_updated") return false;

  signOutToastShownThisLoad = true;
  clearSignOutReason();
  showSignOutToast("access_updated");
  return true;
}

export function resetIdleSessionTimeoutToastGuard(): void {
  signOutToastShownThisLoad = false;
}

export function touchSessionActivity(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
  mirrorSessionActivity?.();
}

export function getLastSessionActivityMs(): number | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_LAST_ACTIVITY_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clearLastSessionActivity(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
}

export function msUntilIdleLogout(now = Date.now()): number {
  const last = getLastSessionActivityMs();
  if (last == null) {
    touchSessionActivity();
    return IDLE_LOGOUT_MS;
  }
  const remaining = IDLE_LOGOUT_MS - (now - last);
  return remaining > 0 ? remaining : 0;
}

/** True when no user/API activity for {@link IDLE_LOGOUT_MS}. */
export function isSessionIdle(now = Date.now()): boolean {
  return msUntilIdleLogout(now) <= 0;
}
