import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { FEEDBACK_PENDING_CHANGED_EVENT } from "@/modules/feedback/api/feedbackApi"
import { fetchPortalNotifications } from "../api/fetchPortalNotifications"
import type { PortalNotification } from "../types/notification.types"
import {
  getReadNotificationIds,
  persistAllNotificationsRead,
  persistNotificationRead,
} from "../utils/notificationReadStorage"
import { NotificationsContext } from "./notificationsContext"

export { NotificationsContext } from "./notificationsContext"
export type { NotificationsContextValue } from "./notificationsContext"

function applyReadState(
  items: Omit<PortalNotification, "read">[],
  readIds: Set<string>,
): PortalNotification[] {
  return items.map((n) => ({ ...n, read: readIds.has(n.id) }))
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const fetched = await fetchPortalNotifications()
      const readIds = getReadNotificationIds()
      setNotifications(applyReadState(fetched, readIds))
      setLoadError(null)
    } catch {
      setNotifications([])
      setLoadError("Could not load notifications. Try again in a moment.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    function onFocus() {
      void refresh()
    }
    function onFeedbackChanged() {
      void refresh()
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener(FEEDBACK_PENDING_CHANGED_EVENT, onFeedbackChanged)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener(
        FEEDBACK_PENDING_CHANGED_EVENT,
        onFeedbackChanged,
      )
    }
  }, [refresh])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  )

  const markRead = useCallback((id: string) => {
    const trimmed = id.trim()
    if (!trimmed) return
    persistNotificationRead(trimmed)
    setNotifications((prev) =>
      prev.map((n) => (n.id === trimmed ? { ...n, read: true } : n)),
    )
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const ids = prev.map((n) => n.id)
      persistAllNotificationsRead(ids)
      return prev.map((n) => ({ ...n, read: true }))
    })
  }, [])

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      isLoading,
      loadError,
      refresh,
      markRead,
      markAllRead,
    }),
    [
      notifications,
      unreadCount,
      isLoading,
      loadError,
      refresh,
      markRead,
      markAllRead,
    ],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}
