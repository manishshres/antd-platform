"use client";

import { Badge, Button, Dropdown, Empty, Typography, theme } from "antd";
import {
  BellOutlined,
  ShoppingOutlined,
  SyncOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import {
  useNotifications,
  type NotificationType,
} from "@/contexts/NotificationsContext";

const { Text } = Typography;

const ICON: Record<NotificationType, React.ReactNode> = {
  order: <ShoppingOutlined />,
  status: <SyncOutlined />,
  printer: <PrinterOutlined />,
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationsBell() {
  const { token } = theme.useToken();
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, clearAll } =
    useNotifications();

  const panel = (
    <div
      style={{
        width: 340,
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text strong>Notifications</Text>
        <div>
          <Button type="link" size="small" onClick={markAllRead} disabled={unreadCount === 0}>
            Mark all read
          </Button>
          <Button type="link" size="small" onClick={clearAll} disabled={notifications.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {notifications.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="You're all caught up"
            style={{ padding: `${token.paddingLG}px 0` }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {notifications.map((n, i) => (
              <div
                key={n.id}
                onClick={() => n.href && router.push(n.href)}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px 16px",
                  cursor: n.href ? "pointer" : "default",
                  background: n.read ? "transparent" : token.colorPrimaryBg,
                  borderBottom: i < notifications.length - 1 ? `1px solid ${token.colorBorderSecondary}` : "none",
                }}
              >
                <div style={{ color: token.colorPrimary, fontSize: 18, marginTop: 2 }}>
                  {ICON[n.type]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 13 }} ellipsis>{n.title}</Text>
                    <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      {timeAgo(n.createdAt)}
                    </Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, display: "block", lineHeight: 1.4 }}>
                    {n.description}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Dropdown
      popupRender={() => panel}
      trigger={["click"]}
      placement="bottomRight"
      onOpenChange={(open) => {
        if (open && unreadCount > 0) markAllRead();
      }}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} aria-label="Notifications" />
      </Badge>
    </Dropdown>
  );
}
