"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useSocket } from "@/hooks/useSocket";

export type NotificationType = "order" | "status" | "printer";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  createdAt: number;
  read: boolean;
  /** Optional in-app link to open when clicked. */
  href?: string;
}

interface NotificationsContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextType>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  clearAll: () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

const MAX_NOTIFICATIONS = 50;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  preparing: "Preparing",
  ready: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface OrderEvent {
  id: string;
  customerName?: string;
  status?: string;
}

interface PrintJobEvent {
  id: string;
  orderId?: string;
  jobType?: string;
  status?: string;
}

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { socket } = useSocket();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const push = useCallback((n: Omit<AppNotification, "id" | "createdAt" | "read">) => {
    setNotifications((prev) =>
      [
        {
          ...n,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
          read: false,
        },
        ...prev,
      ].slice(0, MAX_NOTIFICATIONS),
    );
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onOrderCreated = (order: OrderEvent) => {
      push({
        type: "order",
        title: "New order received",
        description: `Order from ${order.customerName ?? "a customer"}.`,
        href: "/orders",
      });
    };

    const onOrderUpdated = (order: OrderEvent) => {
      push({
        type: "status",
        title: "Order status updated",
        description: `Order for ${order.customerName ?? "a customer"} is now ${
          STATUS_LABEL[order.status ?? ""] ?? order.status ?? "updated"
        }.`,
        href: "/orders",
      });
    };

    const onPrintJob = (job: PrintJobEvent) => {
      // Only surface failures — successful prints are noise.
      if (job.status !== "failed") return;
      push({
        type: "printer",
        title: "Print job failed",
        description: `A ${job.jobType ?? "print"} job could not be printed. Check your printers.`,
        href: "/printers",
      });
    };

    socket.on("order.created", onOrderCreated);
    socket.on("order.updated", onOrderUpdated);
    socket.on("printJob.updated", onPrintJob);

    return () => {
      socket.off("order.created", onOrderCreated);
      socket.off("order.updated", onOrderUpdated);
      socket.off("printJob.updated", onPrintJob);
    };
  }, [socket, push]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, markAllRead, clearAll }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}
