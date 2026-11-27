import {
  registerSessionActivityMirror,
  SESSION_LAST_ACTIVITY_KEY,
} from "./idleSession";
import { publishActiveBrowserUserFromSession } from "./exclusiveBrowserSession";
import {
  AUTH_RETURN_NEXT_KEY,
  PORTAL_SESSION_MIRROR_KEY,
  SESSION_ACTIVITY_SESSION_ID_KEY,
  SESSION_BEARER_KEY,
  SESSION_PORTAL_MODE_KEY,
  SESSION_REFRESH_KEY,
  SESSION_USER_DETAILS_KEY,
  SESSION_WORKSPACE_COMPANY_ID_KEY,
} from "./sessionKeys";

const CHANNEL_NAME = "portal-auth-session";
const HANDOFF_WAIT_MS = 8000;
const MIRROR_IDLE_MS = 30 * 60 * 1000;
const MIRROR_WRITE_GAP_MS = 5000;

let lastMirrorWrite = 0;

function accessTokenExpSeconds(token: string | undefined): number {
  if (!token) return 0;
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function readPortalSessionMirror(): Record<string, string> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PORTAL_SESSION_MIRROR_KEY) ?? "";
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

function mirrorIsIdle(entries: Record<string, string>): boolean {
  const last = Number(entries[SESSION_LAST_ACTIVITY_KEY]);
  return Number.isFinite(last) && Date.now() - last >= MIRROR_IDLE_MS;
}

/** Keys a signed-in tab can give a new tab. Sign-out notices stay on their own tab. */
const HANDOFF_KEYS = [
  SESSION_BEARER_KEY,
  SESSION_REFRESH_KEY,
  SESSION_USER_DETAILS_KEY,
  SESSION_PORTAL_MODE_KEY,
  SESSION_ACTIVITY_SESSION_ID_KEY,
  SESSION_WORKSPACE_COMPANY_ID_KEY,
  SESSION_LAST_ACTIVITY_KEY,
  AUTH_RETURN_NEXT_KEY,
] as const;

type HandoffRequest = { type: "request"; requestId: string };
type HandoffSession = {
  type: "session";
  requestId: string;
  entries: Record<string, string>;
};

let responderInstalled = false;
let inFlight: Promise<boolean> | null = null;

function readHandoffEntries(): Record<string, string> | null {
  if (typeof sessionStorage === "undefined") return null;
  const token = sessionStorage.getItem(SESSION_BEARER_KEY)?.trim();
  if (!token) return null;
  const entries: Record<string, string> = {};
  for (const key of HANDOFF_KEYS) {
    const value = sessionStorage.getItem(key);
    if (value) entries[key] = value;
  }
  return entries;
}

function applyHandoffEntries(entries: Record<string, string>): boolean {
  const token = entries[SESSION_BEARER_KEY]?.trim();
  if (!token || typeof sessionStorage === "undefined") return false;
  for (const key of HANDOFF_KEYS) {
    const value = entries[key];
    if (typeof value === "string" && value.length > 0) {
      sessionStorage.setItem(key, value);
    }
  }
  publishActiveBrowserUserFromSession();
  return true;
}

function mirrorEntriesFromSession(): Record<string, string> | null {
  return readHandoffEntries();
}

/**
 * Take the shared copy when it is a newer sign-in than this tab.
 * A duplicated tab still holds the token it was copied with; another tab may
 * already have refreshed. Copying that stale token back would sign the next
 * tab out.
 */
export function adoptNewerPortalSessionMirror(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const entries = readPortalSessionMirror();
  if (!entries || mirrorIsIdle(entries)) return false;
  const mirrorToken = entries[SESSION_BEARER_KEY]?.trim() ?? "";
  if (!mirrorToken) return false;
  const mine = sessionStorage.getItem(SESSION_BEARER_KEY)?.trim() ?? "";
  if (mirrorToken === mine) return false;
  if (mine && accessTokenExpSeconds(mirrorToken) <= accessTokenExpSeconds(mine)) {
    return false;
  }
  return applyHandoffEntries(entries);
}

/** Keep a copy of this tab's sign-in for the next tab that opens a link. */
export function syncPortalSessionMirror(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const entries = mirrorEntriesFromSession();
    if (!entries) return;
    const existing = readPortalSessionMirror();
    if (existing && !mirrorIsIdle(existing)) {
      const existingExp = accessTokenExpSeconds(existing[SESSION_BEARER_KEY]);
      const mineExp = accessTokenExpSeconds(entries[SESSION_BEARER_KEY]);
      if (existingExp > mineExp) {
        applyHandoffEntries(existing);
        return;
      }
      const existingLast = Number(existing[SESSION_LAST_ACTIVITY_KEY]);
      const mineLast = Number(entries[SESSION_LAST_ACTIVITY_KEY]);
      if (
        Number.isFinite(existingLast) &&
        (!Number.isFinite(mineLast) || existingLast > mineLast)
      ) {
        entries[SESSION_LAST_ACTIVITY_KEY] = String(existingLast);
        sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(existingLast));
      }
    }
    const serialized = JSON.stringify(entries);
    if (localStorage.getItem(PORTAL_SESSION_MIRROR_KEY) === serialized) {
      lastMirrorWrite = Date.now();
      return;
    }
    localStorage.setItem(PORTAL_SESSION_MIRROR_KEY, serialized);
    lastMirrorWrite = Date.now();
  } catch {
    /* private mode / blocked storage */
  }
}

function publishIfSignedIn(): void {
  if (typeof sessionStorage === "undefined") return;
  if (!sessionStorage.getItem(SESSION_BEARER_KEY)?.trim()) return;
  syncPortalSessionMirror();
}

/** Activity can update the copy often; skip writes that are only a few seconds apart. */
export function syncPortalSessionMirrorThrottled(): void {
  if (Date.now() - lastMirrorWrite < MIRROR_WRITE_GAP_MS) return;
  syncPortalSessionMirror();
}

registerSessionActivityMirror(syncPortalSessionMirrorThrottled);

function tryHydrateFromMirror(): boolean {
  const entries = readPortalSessionMirror();
  if (!entries) return false;
  if (!applyHandoffEntries(entries)) return false;
  if (!sessionStorage.getItem(SESSION_LAST_ACTIVITY_KEY)) {
    sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
  }
  syncPortalSessionMirror();
  return true;
}

/**
 * New tabs start with an empty sessionStorage. Copy the sign-in before React
 * renders so Customers and every other signed-in page open without asking again.
 * A duplicated tab already has a copied sign-in; publish that so the next tab
 * opened from it stays signed in. A copy older than the idle limit is ignored.
 */
export function hydratePortalSessionFromMirror(): void {
  if (typeof sessionStorage === "undefined") return;
  if (sessionStorage.getItem(SESSION_BEARER_KEY)?.trim()) {
    syncPortalSessionMirror();
    return;
  }
  tryHydrateFromMirror();
}

/**
 * Signed-in tabs answer a new tab that opened a link with "Open in new tab".
 * That navigation does not copy sessionStorage, so the new tab would otherwise
 * look signed out.
 */
export function installPortalSessionTabHandoff(): void {
  if (typeof window === "undefined" || responderInstalled) return;
  responderInstalled = true;

  // Right-click and middle-click happen before "Open in new tab" loads the
  // new page. Publish first so a tab that was itself duplicated still hands
  // off the sign-in it is showing.
  const publishOnNewTabGesture = (event: Event) => {
    const button = "button" in event ? Number((event as MouseEvent).button) : 0;
    if (event.type === "pointerdown" && button !== 1 && button !== 2) return;
    publishIfSignedIn();
  };
  document.addEventListener("pointerdown", publishOnNewTabGesture, true);
  document.addEventListener("auxclick", publishIfSignedIn, true);
  document.addEventListener("contextmenu", publishIfSignedIn, true);
  document.addEventListener(
    "click",
    (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
        publishIfSignedIn();
      }
    },
    true,
  );
  const restoreOnPageShow = () => {
    if (sessionIsPresent()) publishIfSignedIn();
    else tryHydrateFromMirror();
  };
  window.addEventListener("pageshow", restoreOnPageShow);
  window.addEventListener("load", restoreOnPageShow);
  window.addEventListener("storage", (event) => {
    if (event.key !== PORTAL_SESSION_MIRROR_KEY || !event.newValue) return;
    adoptNewerPortalSessionMirror();
  });
  window.setInterval(publishIfSignedIn, 2000);

  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<HandoffRequest>) => {
    if (event.data?.type !== "request" || !event.data.requestId) return;
    const entries = readHandoffEntries();
    if (!entries) return;
    const message: HandoffSession = {
      type: "session",
      requestId: event.data.requestId,
      entries,
    };
    channel.postMessage(message);
  };
}

function sessionIsPresent(): boolean {
  return Boolean(
    typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_BEARER_KEY)?.trim(),
  );
}

function requestOnce(): Promise<boolean> {
  if (typeof sessionStorage === "undefined") return Promise.resolve(false);
  if (sessionIsPresent()) return Promise.resolve(true);
  if (tryHydrateFromMirror()) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    let poll = 0;
    let timer = 0;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timer);
      channel?.close();
      if (ok) syncPortalSessionMirror();
      resolve(ok);
    };
    const started = Date.now();
    let sawCompleteAt = document.readyState === "complete" ? started : 0;
    poll = window.setInterval(() => {
      if (sessionIsPresent() || tryHydrateFromMirror()) {
        finish(true);
        return;
      }
      if (document.readyState === "complete" && !sawCompleteAt) {
        sawCompleteAt = Date.now();
      }
      // Duplicate tab copies sessionStorage when the page finishes loading.
      const waitedForClone =
        sawCompleteAt > 0 && Date.now() - sawCompleteAt >= 700;
      if (waitedForClone || Date.now() - started >= HANDOFF_WAIT_MS) {
        finish(sessionIsPresent());
      }
    }, 50);
    if (typeof BroadcastChannel === "undefined") return;

    channel = new BroadcastChannel(CHANNEL_NAME);
    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    channel.onmessage = (event: MessageEvent<HandoffSession>) => {
      const data = event.data;
      if (data?.type !== "session" || data.requestId !== requestId) return;
      finish(applyHandoffEntries(data.entries ?? {}));
    };
    const request: HandoffRequest = { type: "request", requestId };
    channel.postMessage(request);
  });
}

/** Copy the signed-in session from another open tab into this one. */
export function requestPortalSessionFromOpenTab(): Promise<boolean> {
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_BEARER_KEY)?.trim()) {
    return Promise.resolve(true);
  }
  if (!inFlight) {
    inFlight = requestOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
