import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  markIdleSessionTimeoutNotice,
  msUntilIdleLogout,
  SESSION_LAST_ACTIVITY_KEY,
  touchSessionActivity,
} from "./idleSession";
import { performPortalLogout } from "./portalLogout";
import { syncPortalSessionMirror } from "./sessionTabHandoff";

const ACTIVITY_THROTTLE_MS = 1000;

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "pointerdown",
  "pointermove",
  "keydown",
  "keyup",
  "input",
  "scroll",
  "touchstart",
  "click",
  "wheel",
  "focusin",
];

/**
 * Signs the user out after {@link IDLE_LOGOUT_MS} with no pointer/keyboard/scroll/API activity.
 * Mount once inside authenticated shell (RequireAuth).
 */
export function useIdleLogout(): void {
  const navigate = useNavigate();
  const loggingOutRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const lastTouchRef = useRef(0);

  useEffect(() => {
    function clearTimer() {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    async function logoutForIdle() {
      if (loggingOutRef.current) return;
      // Timer may have been scheduled before recent activity — verify still idle.
      if (msUntilIdleLogout() > 0) {
        scheduleLogout();
        return;
      }
      loggingOutRef.current = true;
      clearTimer();
      markIdleSessionTimeoutNotice();
      try {
        await performPortalLogout();
      } finally {
        navigate("/signin", { replace: true, state: { idleLogout: true } });
      }
    }

    function scheduleLogout() {
      clearTimer();
      const remaining = msUntilIdleLogout();
      if (remaining <= 0) {
        void logoutForIdle();
        return;
      }
      timeoutRef.current = window.setTimeout(() => {
        void logoutForIdle();
      }, remaining);
    }

    function onActivity() {
      const now = Date.now();
      if (now - lastTouchRef.current < ACTIVITY_THROTTLE_MS) return;
      lastTouchRef.current = now;
      touchSessionActivity();
      scheduleLogout();
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== SESSION_LAST_ACTIVITY_KEY) return;
      scheduleLogout();
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (msUntilIdleLogout() <= 0) {
        void logoutForIdle();
      } else {
        scheduleLogout();
      }
    }

    // A duplicated tab can copy an older activity time before the shared copy
    // arrives. Publish first so an active session is not signed out on load.
    syncPortalSessionMirror();
    const scheduleAfterLoad = () => scheduleLogout();
    if (document.readyState === "complete") {
      scheduleLogout();
    } else {
      window.addEventListener("load", scheduleAfterLoad, { once: true });
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimer();
      window.removeEventListener("load", scheduleAfterLoad);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [navigate]);
}
