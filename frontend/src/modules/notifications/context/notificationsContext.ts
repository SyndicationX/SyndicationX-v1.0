import { createContext } from "react"
import type { PortalNotification } from "../types/notification.types"

export interface NotificationsContextValue {
  notifications: PortalNotification[]
  unreadCount: number
  isLoading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  markRead: (id: string) => void
  markAllRead: () => void
}

export const NotificationsContext = createContext<
  NotificationsContextValue | undefined
>(undefined)
