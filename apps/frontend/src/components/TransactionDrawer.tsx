"use client";

import { useEffect, useState } from "react";
import { Drawer, Typography, Space, Button, Tag, Divider, Spin, App, Flex, Input } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import { formatPrice, formatPhone } from "@/lib/format";

const { Text, Title } = Typography;

interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  totalAmount: number;
  paymentMethod?: string | null;
  paidAt?: string | null;
  createdAt: string;
  items?: OrderItem[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: "gold",
  preparing: "blue",
  ready: "cyan",
  completed: "green",
  cancelled: "red",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  preparing: "Preparing",
  ready: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TransactionDrawer({
  orderId,
  open,
  onClose,
  isAdmin,
}: {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const { message } = App.useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printerId, setPrinterId] = useState("");

  useEffect(() => {
    if (!orderId || !open) return;
    setLoading(true);
    let cancelled = false;
    api
      .get<Order>(`/orders/${orderId}`)
      .then(({ data }) => {
        if (!cancelled) setOrder(data);
      })
      .catch(() => {
        if (!cancelled) message.error("Failed to load order details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, open, message]);

  const updateStatus = async (newStatus: string) => {
    if (!order) return;
    setActionLoading(true);
    try {
      const { data } = await api.patch<Order>(`/orders/${order.id}/status`, {
        status: newStatus,
      });
      message.success(`Order status updated to ${STATUS_LABEL[newStatus]}`);
      setOrder(data);
    } catch {
      message.error("Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!order) return;
    setPrintLoading(true);
    try {
      await api.post(`/orders/${order.id}/print`, {
        printerId: printerId?.trim() || undefined,
      });
      message.success("Order dispatched to MQTT print queue!");
    } catch {
      message.error("Failed to enqueue print job.");
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <Drawer
      title={null}
      placement="right"
      onClose={onClose}
      open={open}
      width={400}
      styles={{ body: { padding: "24px 32px", background: "#FFFFFF", color: "#101418" } }}
    >
      {loading ? (
        <div style={{ textAlign: "center", paddingTop: 40 }}>
          <Spin />
        </div>
      ) : order ? (
        <Flex vertical>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <Title level={4} style={{ margin: 0, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {order.ticketNumber != null ? `#${order.ticketNumber}` : `#${order.id.slice(0, 6)}`}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>{new Date(order.createdAt).toLocaleString()}</Text>
          </div>

          <Divider style={{ margin: "16px 0", borderBlockStart: "1px dashed #EDEEF1" }} />

          {/* Customer Info */}
          <div style={{ marginBottom: 16 }}>
            <Text style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{order.customerName}</Text>
            <Text style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 13, color: "#5B6270" }}>
              {formatPhone(order.customerPhone)}
            </Text>
          </div>

          <div style={{ marginBottom: 24 }}>
            <Tag color={STATUS_COLOR[order.status] || "default"} style={{ margin: 0 }}>
              {STATUS_LABEL[order.status] || order.status}
            </Tag>
          </div>

          <Divider style={{ margin: "16px 0", borderBlockStart: "1px dashed #EDEEF1" }} />

          {/* Items */}
          <div style={{ flex: 1, minHeight: 150 }}>
            {order.items && order.items.length > 0 ? (
              order.items.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <Text style={{ display: "block", fontSize: 14 }}>{item.menuItemName}</Text>
                    <Text type="secondary" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                      {item.quantity} × {formatPrice(item.price)}
                    </Text>
                  </div>
                  <div style={{ paddingLeft: 12 }}>
                    <Text style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>
                      {formatPrice(item.price * item.quantity)}
                    </Text>
                  </div>
                </div>
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>No items in this order.</Text>
            )}
          </div>

          <Divider style={{ margin: "16px 0", borderBlockStart: "1px dashed #101418" }} />

          {/* Total */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>Total</Text>
            <Text style={{ fontSize: 24, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
              {formatPrice(order.totalAmount)}
            </Text>
          </div>

          {/* Admin Actions */}
          {isAdmin && (
            <>
              <div style={{ background: "#F9FAFB", padding: 16, borderRadius: 4, marginBottom: 16 }}>
                <Text style={{ fontSize: 11, fontWeight: 600, color: "#8E95A3", textTransform: "uppercase", marginBottom: 12, display: "block" }}>
                  Status Actions
                </Text>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Button
                    block
                    onClick={() => updateStatus("preparing")}
                    disabled={order.status !== "pending" || actionLoading}
                  >
                    Start Preparing
                  </Button>
                  <Button
                    block
                    onClick={() => updateStatus("ready")}
                    disabled={order.status !== "preparing" || actionLoading}
                  >
                    Ready for Pickup
                  </Button>
                  <Button
                    block
                    onClick={() => updateStatus("completed")}
                    disabled={order.status !== "ready" || actionLoading}
                  >
                    Complete Order
                  </Button>
                  <Button
                    block
                    danger
                    onClick={() => updateStatus("cancelled")}
                    disabled={["completed", "cancelled"].includes(order.status) || actionLoading}
                  >
                    Cancel Order
                  </Button>
                </Space>
              </div>

              <div style={{ background: "#F9FAFB", padding: 16, borderRadius: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: 600, color: "#8E95A3", textTransform: "uppercase", marginBottom: 12, display: "block" }}>
                  Print
                </Text>
                <Input
                  placeholder="Printer ID (Optional)"
                  value={printerId}
                  onChange={(e) => setPrinterId(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <Button block onClick={handlePrint} loading={printLoading} icon={<PrinterOutlined />}>
                  Print Receipt
                </Button>
              </div>
            </>
          )}
        </Flex>
      ) : null}
    </Drawer>
  );
}
