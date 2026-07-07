"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  Typography,
  Space,
  Button,
  Descriptions,
  Tag,
  Divider,
  Input,
  message,
  theme,
  Spin,
} from "antd";
import { ArrowLeftOutlined, PrinterOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { formatPrice, formatPhone } from "@/lib/format";

const { Title, Text } = Typography;

interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  price: number; // in cents
}

interface Order {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  totalAmount: number;
  source?: string | null;
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

export default function OrderDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  const { token } = theme.useToken();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  // Role comes from the JWT once at mount — lazy initializer avoids a
  // set-state-in-effect cascade.
  const [isAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    const tokenStr = localStorage.getItem("access_token");
    if (!tokenStr) return false;
    try {
      const payload = tokenStr.split(".")[1];
      const decoded = JSON.parse(
        window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      return ["admin", "sysadmin"].includes(decoded.role?.toLowerCase() || "");
    } catch {
      return false;
    }
  });

  const [printLoading, setPrintLoading] = useState(false);
  const [printerId, setPrinterId] = useState("");

  const load = () => {
    if (!orderId) return;
    setLoading(true);
    api
      .get<Order>(`/orders/${orderId}`)
      .then(({ data }) => setOrder(data))
      .catch(() => message.error("Failed to load order details."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Initial fetch inline (loading already starts true) — `load` stays for
    // post-action refreshes where the synchronous spinner reset is wanted.
    if (!orderId) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

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

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Title level={4}>Order not found</Title>
        <Button onClick={() => router.push("/orders")}>Back to Orders</Button>
      </div>
    );
  }

  return (
    <>
      <Space style={{ marginBottom: token.marginMD }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push("/orders")}
        >
          Back to Orders
        </Button>
      </Space>

      <PageHeader
        title={`Order ${order.ticketNumber != null ? `#${order.ticketNumber}` : `#${order.id.slice(0, 6)}`}`}
        subtitle={`Customer: ${order.customerName}`}
      />

      <Card variant="borderless" style={{ maxWidth: 800 }}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Order ID">
              <Text copyable style={{ fontSize: 12 }}>
                {order.id}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Customer">
              {order.customerName}
            </Descriptions.Item>
            <Descriptions.Item label="Phone">
              {formatPhone(order.customerPhone)}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={STATUS_COLOR[order.status] || "default"}>
                {STATUS_LABEL[order.status] || order.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Total Price">
              <Text style={{ fontWeight: 600 }}>
                {formatPrice(order.totalAmount)}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Payment Method">
              {order.paymentMethod ? (
                <Tag color="cyan">{order.paymentMethod.toUpperCase()}</Tag>
              ) : (
                <Text type="secondary">Unpaid</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Created At">
              {new Date(order.createdAt).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="Paid At">
              {order.paidAt ? new Date(order.paidAt).toLocaleString() : "—"}
            </Descriptions.Item>
          </Descriptions>

          <div>
            <Title level={5} style={{ marginBottom: 12 }}>
              Order Items
            </Title>
            {order.items && order.items.length > 0 ? (
              order.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: token.marginSM,
                  }}
                >
                  <div>
                    <Text style={{ fontWeight: 500 }}>{item.menuItemName}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.quantity} × {formatPrice(item.price)}
                      </Text>
                    </div>
                  </div>
                  <Text style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatPrice(item.price * item.quantity)}
                  </Text>
                </div>
              ))
            ) : (
              <Text type="secondary">No items in this order.</Text>
            )}
          </div>

          {isAdmin && (
            <>
              <Divider style={{ margin: `${token.marginSM}px 0` }} />

              <div>
                <Title level={5} style={{ marginBottom: token.marginSM }}>
                  Manage Order Status
                </Title>
                <Space wrap size={8}>
                  <Button
                    onClick={() => updateStatus("preparing")}
                    disabled={order.status !== "pending" || actionLoading}
                    type="primary"
                  >
                    Start Preparing
                  </Button>
                  <Button
                    onClick={() => updateStatus("ready")}
                    disabled={order.status !== "preparing" || actionLoading}
                    color="cyan"
                    variant="solid"
                  >
                    Ready for Pickup
                  </Button>
                  <Button
                    onClick={() => updateStatus("completed")}
                    disabled={order.status !== "ready" || actionLoading}
                    color="green"
                    variant="solid"
                  >
                    Complete Order
                  </Button>
                  <Button
                    onClick={() => updateStatus("cancelled")}
                    disabled={
                      ["completed", "cancelled"].includes(order.status) ||
                      actionLoading
                    }
                    danger
                  >
                    Cancel Order
                  </Button>
                </Space>
              </div>

              <Divider style={{ margin: `${token.marginSM}px 0` }} />

              <div>
                <Title level={5} style={{ marginBottom: token.marginSM }}>
                  MQTT Print Job
                </Title>
                <Input
                  placeholder="Optional printer ID / subtopic (leave blank for all)"
                  value={printerId}
                  onChange={(event) => setPrinterId(event.target.value)}
                  style={{ marginBottom: token.marginSM }}
                  allowClear
                />
                <Button
                  onClick={handlePrint}
                  loading={printLoading}
                  icon={<PrinterOutlined />}
                  type="primary"
                  style={{ width: "100%", marginTop: token.marginSM }}
                >
                  Send to Kitchen &amp; Receipt Printers
                </Button>
              </div>
            </>
          )}
        </Space>
      </Card>
    </>
  );
}
